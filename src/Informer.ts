/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
/* eslint-disable no-console */
import {ListPromise} from '@kubernetes/client-node';
import {Cache} from './Cache';
import {PassThrough, Transform} from 'stream';
import {Agent} from 'https';
import * as k8s from '@kubernetes/client-node';
import * as https from 'https';
import {EventEmitter} from 'events';
import * as byline from 'byline';

export enum EVENT {
  ADDED = 'ADDED',
  UPDATED = 'UPDATED',
  DELETED = 'DELETED',
  ERROR = 'ERROR',
  BOOKMARK = 'BOOKMARK',
  CONNECT = 'CONNECT',
  DISCONNECT = 'DISCONNECT',
  USER_ABORT = 'USER_ABORT',
}

export class SimpleTransform extends Transform {
  constructor() {
    super({objectMode: true});
  }

  _transform(chunk: any, encoding: any, callback: any) {
    const data = JSON.parse(chunk);
    let phase: EVENT = data.type;
    switch (data.type) {
      case 'MODIFIED':
        phase = EVENT.UPDATED;
        break;
    }

    this.push({phase, object: data.object, watchObj: data});
    callback();
  }
}

export class Informer<T extends k8s.KubernetesObject> {
  private controller: AbortController = new AbortController();
  events = new EventEmitter();
  stream = new PassThrough({objectMode: true});
  private started = false;

  public cache: Cache<T> | null = null;

  public constructor(
    private readonly path: string,
    private listFn: ListPromise<T>,
    private kubeConfig: k8s.KubeConfig,
    private enableCache: boolean = true,
    private resourceVersion?: string,
    private clearResourceVersion: boolean = false
  ) {
    if (this.enableCache) {
      this.cache = new Cache<T>();
    }
    this.stream.on('data', (watchEvent: any) => {
      this.watchHandler(watchEvent.phase, watchEvent.object, watchEvent.watchObj);
    });
  }

  public async start(): Promise<void> {
    if (this.started) {
      console.warn('informer has already started');
      return;
    }
    this.controller = new AbortController();
    this.events.on(EVENT.DISCONNECT, (url) => {
      console.log(`Disconnected from: ${url}`);
      if (this.started) {
        this.started = false;
        if (this.clearResourceVersion) {
          this.resourceVersion = undefined;
        }
        setTimeout(async () => {
          if (!this.controller.signal.aborted) {
            await this.makeWatchRequest();
          }
        }, 1000);
      }
    });
    await this.makeWatchRequest();
  }

  public stop(): void {
    this.controller.abort();
    this.started = false;
  }

  public isStarted(): boolean {
    return this.started;
  }

  private getSetKey(object: k8s.KubernetesObject): string {
    return `${object.metadata?.namespace}-${object.metadata?.name}}`;
  }

  private async makeWatchRequest(): Promise<void> {
    if (this.enableCache) {
      this.resourceVersion = await this.cache?.processListRequest(this.listFn);
    } else if (!this.resourceVersion) {
      try {
        const response = await this.listFn();
        this.resourceVersion = response.body.metadata?.resourceVersion || '';
      } catch (error) {
        this.events.emit(EVENT.ERROR, error);
        this.resourceVersion = undefined;
      }
    }
    const cluster = this.kubeConfig.getCurrentCluster();

    const params: URLSearchParams = new URLSearchParams({
      allowWatchBookmarks: 'true',
      watch: 'true',
    });

    if (this.resourceVersion) {
      params.append('resourceVersion', this.resourceVersion);
    }

    const httpsAgent = new Agent({
      keepAlive: true,
    });

    const options: https.RequestOptions = {
      hostname: cluster?.server,
      path: this.path + '?' + params,
      agent: httpsAgent,
      method: 'GET',
      signal: this.controller.signal,
    };

    this.kubeConfig.applyToHTTPSOptions(options);

    const stream = byline.createStream();
    const simpleTransform = new SimpleTransform();

    const url = cluster?.server + this.path + '?' + params;

    console.log(options);
    try {
      const req = https.request(options, (res) => {
        console.log(`Status Code: ${res.statusCode}`);
        this.events.emit(EVENT.CONNECT, url);

        res.pipe(stream).pipe(simpleTransform).pipe(this.stream, {end: false});

        res.on('end', () => {
          this.events.emit(EVENT.DISCONNECT, url);
        });

        res.on('error', (err: any) => {
          if (err?.type !== 'aborted') {
            this.events.emit(EVENT.ERROR, err);
          } else {
            this.events.emit(EVENT.USER_ABORT, err);
          }
        });
      });

      req.on('error', (err: any) => {
        if (err?.type !== 'aborted') {
          this.events.emit(EVENT.ERROR, err);
        } else {
          this.events.emit(EVENT.USER_ABORT, err);
        }
        httpsAgent.destroy();
      });

      req.end();

      this.started = true;
    } catch (err: any) {
      if (err?.type !== 'aborted') {
        this.events.emit(EVENT.ERROR, err);
      } else {
        this.events.emit(EVENT.USER_ABORT, err);
      }
      httpsAgent.destroy();
    }
  }

  private handleError(err) {
    this.events.emit(EVENT.ERROR, err);
  }

  // eslint-disable-next-line max-len
  private watchHandler(phase: string, obj: T, watchObj?: any): void {
    switch (phase) {
      case EVENT.ADDED:
        this.cache && this.cache.addOrUpdateObject(obj);
        this.events.emit(phase, obj);
        break;
      case EVENT.UPDATED:
        this.cache && this.cache.addOrUpdateObject(obj);
        this.events.emit(phase, obj);
        break;
      case EVENT.DELETED:
        this.cache && this.cache.deleteObject(obj);
        this.events.emit(phase, obj);
        break;
      case EVENT.BOOKMARK:
        // nothing to do, here for documentation, mostly.
        if (watchObj.object?.metadata?.resourceVersion) {
          this.resourceVersion = watchObj.object?.metadata?.resourceVersion;
        }
        this.events.emit(phase, obj);
        break;
      case EVENT.ERROR:
        const error: any = obj;
        if (error.code !== 410) {
          this.events.emit(phase, obj);
        } else {
          this.resourceVersion = '';
          this.stop();
          this.start().then(() => {
            this.events.emit(EVENT.ERROR, 'Restarted due to 410');
          });
        }
        break;
    }
  }
}
