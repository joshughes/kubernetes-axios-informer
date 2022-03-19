/* eslint-disable no-console */
import { ListPromise } from '@kubernetes/client-node'
import { Cache } from './Cache'
import { PassThrough, Transform } from 'stream'
import { AbortController } from 'node-abort-controller'
import { Agent } from 'https'
import * as k8s from '@kubernetes/client-node'
import * as https from 'https'
import fetch, { Headers } from 'node-fetch'
import * as EventEmitter from 'events'
import * as byline from 'byline'

export enum EVENT {
  ADDED = 'ADDED',
  UPDATED = 'UPDATED',
  DELETED = 'DELETED',
  ERROR = 'ERROR',
  BOOKMARK = 'BOOKMARK',
  CONNECT = 'CONNECT'
}

export class SimpleTransform extends Transform {
  constructor() {
    super({ objectMode: true })
  }

  _transform(chunk: any, encoding: any, callback: any) {
    const data = JSON.parse(chunk)
    let phase: EVENT = data.type
    switch (data.type) {
      case 'MODIFIED':
        phase = EVENT.UPDATED
        break
    }

    this.push({ phase, object: data.object, watchObj: data })
    callback()
  }
}

export class Informer<T> {
  private controller: AbortController = new AbortController()
  events = new EventEmitter()
  stream = new PassThrough({ objectMode: true })
  private started = false
  private resourceVersion: string | undefined = undefined

  public cache: Cache<T> | null = null

  public constructor(
    private readonly path: string,
    private listFn: ListPromise<T>,
    private kubeConfig: k8s.KubeConfig,
    private enableCache: boolean = true
  ) {
    if (this.enableCache) {
      this.cache = new Cache<T>()
    }
    this.stream.on('data', (watchEvent: any) => {
      this.watchHandler(watchEvent.phase, watchEvent.object, watchEvent.watchObj)
    })
  }

  public async start(): Promise<void> {
    if (this.started) {
      console.warn('informer has already started')
      return
    }
    this.started = true
    await this.makeWatchRequest()
  }

  public stop(): void {
    this.started = false
    this.controller.abort()
  }

  private getSetKey(object: k8s.KubernetesObject): string {
    return `${object.metadata?.namespace}-${object.metadata?.name}}`
  }

  private async makeWatchRequest(): Promise<void> {
    if (!this.resourceVersion && this.enableCache) {
      this.resourceVersion = await this.cache?.processListRequest(this.listFn)
    } else {
      const response = await this.listFn()
      this.resourceVersion = response.body.metadata?.resourceVersion || ''
    }
    const cluster = this.kubeConfig.getCurrentCluster()

    const opts: https.RequestOptions = {}

    const params: URLSearchParams = new URLSearchParams({
      allowWatchBookmarks: 'true',
      watch: 'true'
    })

    if (this.resourceVersion) {
      params.append('resourceVersion', this.resourceVersion)
    }

    this.kubeConfig.applytoHTTPSOptions(opts)

    const stream = byline.createStream()
    const simpleTransform = new SimpleTransform()

    const httpsAgent = new Agent({
      keepAlive: true,
      ca: opts.ca,
      cert: opts.cert,
      key: opts.key,
      rejectUnauthorized: opts.rejectUnauthorized
    })

    const url = cluster?.server + this.path + '?' + params

    const headers = new Headers()

    for (const key in opts.headers) {
      const header = opts.headers[key]?.toString()
      if (header !== undefined) {
        headers.set(key, header)
      }
    }
    console.log(url)
    fetch(url, {
      method: 'GET',
      headers,
      signal: this.controller.signal,
      agent: httpsAgent
    })
      .then((response) => {
        if (response.body !== null) {
          this.events.emit('connect')
          response.body.pipe(stream).pipe(simpleTransform).pipe(this.stream, { end: false })
          response.body
            .on('end', () => console.log('request end'))
            .on('close', async () => {
              if (this.started) {
                await this.makeWatchRequest()
              }
            })
            .on('aborted', () => console.log('request aborted'))
            .on('error', (err: Error) => {
              if (err.name !== 'AbortError') {
                console.log(err, 'Caught error here!')
                this.events.emit('error', err)
              }
            })
        }
      })
      .catch((err) => {
        console.error(err)
        httpsAgent.destroy()
      })
  }

  private handleError(err) {
    this.events.emit(EVENT.ERROR, err)
  }

  private watchHandler(phase: string, obj: T, watchObj?: any): void {
    switch (phase) {
      case EVENT.ADDED:
        this.cache && this.cache.addOrUpdateObject(obj)
        this.events.emit(phase, obj)
        break
      case EVENT.UPDATED:
        this.cache && this.cache.addOrUpdateObject(obj)
        this.events.emit(phase, obj)
        break
      case EVENT.DELETED:
        this.cache && this.cache.deleteObject(obj)
        this.events.emit(phase, obj)
        break
      case EVENT.BOOKMARK:
        // nothing to do, here for documentation, mostly.
        if (watchObj.object?.metadata?.resourceVersion) {
          this.resourceVersion = watchObj.object?.metadata?.resourceVersion
        }
        break
    }
    if (watchObj?.metadata) {
      console.log(`Updating resourceVersion to ${watchObj.metadata.resourceVersion}`)
      this.resourceVersion = watchObj.metadata.resourceVersion
    }
  }
}
