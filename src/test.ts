/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
/* eslint-disable no-console */

import * as k8s from '@kubernetes/client-node';
// import { Stream, Readable, PassThrough } from 'stream'
import {Informer, EVENT} from './Informer';

async function listClusterTektonTaskRuns(): Promise<any> {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const k8sClient = await kc.makeApiClient(k8s.CustomObjectsApi);
  const taskRuns = await k8sClient.listNamespacedCustomObject(
    'tekton.dev',
    'v1beta1',
    "controltower-dev-ha",
    'taskruns',
  );

  return taskRuns;

}

async function main() {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const api = kc.makeApiClient(k8s.CoreV1Api);

  const listFn = () => api.listNamespace();

  const url = `/apis/tekton.dev/v1beta1/namespaces/controltower-dev-ha/taskruns`;
  const informer = new Informer(url, listFn, kc, false);
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
