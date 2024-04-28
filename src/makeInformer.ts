/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
import {KubeConfig, ListPromise} from '@kubernetes/client-node';

import {Informer} from './Informer';
import * as k8s from '@kubernetes/client-node';

export function makeInformer<T extends k8s.KubernetesObject>(
    kubeConfig: KubeConfig,
    path: string,
    listPromiseFn: ListPromise<T>,
    enableCache = true
): Informer<T> {
  const informer = new Informer<T>(path, listPromiseFn, kubeConfig, enableCache);

  return informer;
}
