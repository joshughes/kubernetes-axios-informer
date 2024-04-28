/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
/* eslint-disable no-console */

import * as k8s from '@kubernetes/client-node';
// import { Stream, Readable, PassThrough } from 'stream'
import {Informer, EVENT} from './Informer';

async function main() {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const api = kc.makeApiClient(k8s.CoreV1Api);

  const listFn = () => api.listNamespace();

  const informer = new Informer('/api/v1/namespaces', listFn, kc, false);
  informer.events.on(EVENT.CONNECT, (event) => {
    console.log({event, connect: 'connect'});
  });
  informer.events.on(EVENT.DISCONNECT, (event) => {
    console.log({event, disconnect: 'disconnect'});
  });
  informer.events.on(EVENT.USER_ABORT, (event) => {
    console.log({event, abort: 'abort'});
  });

  informer.stream.on('data', (streamData) => {
    console.log({ streamData });
  });

  informer.events.on(EVENT.ERROR, async (error) => {
    console.log({ error }, 'FOUND ERROR')
    informer.stop()
    // await informer.start()
  })

  informer.events.on(EVENT.BOOKMARK, (event) => {
    console.log(`${JSON.stringify(event, null, 2)}`);
  });

  informer.events.on(EVENT.CONNECT, () => {
    console.log('CONNECTED');
  });

  informer.start();
}

main();
