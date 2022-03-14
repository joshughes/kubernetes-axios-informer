/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { KubernetesObject, ListPromise } from '@kubernetes/client-node'

export type ObjectCallback<T extends KubernetesObject> = (obj: T) => void

export class Cache<T extends KubernetesObject> {
  private objects: T[] = []
  private readonly indexCache: { [key: string]: T[] } = {}

  public list(namespace?: string): ReadonlyArray<T> {
    if (!namespace) {
      return this.objects as ReadonlyArray<T>
    }

    return this.indexCache[namespace] as ReadonlyArray<T>
  }

  public get(name: string, namespace?: string) {
    return this.objects.find(
      (object) => object.metadata?.name === name && (!namespace || namespace === object.metadata?.namespace)
    )
  }

  public syncObjects(objects: T[]): void {
    this.objects = objects
  }

  public addOrUpdateObject(item: T): void {
    addOrUpdateObject(this.objects, item)
  }

  public deleteObject(object: T): void {
    const index = findKubernetesObject(this.objects, object)
    if (index !== -1) {
      this.objects.splice(index, 1)
    }
  }

  public async processListRequest(listPromise: ListPromise<T>): Promise<string> {
    const result = await listPromise()
    const list = result.body
    Object.keys(this.objects).forEach((key) => {
      const updateObjects = deleteItems(this.indexCache[key], list.items)
      if (updateObjects.length !== 0) {
        this.indexCache[key] = updateObjects
      } else {
        delete this.indexCache[key]
      }
    })
    this.addOrUpdateItems(list.items)
    return list.metadata!.resourceVersion!
  }

  private addOrUpdateItems(items: T[]): void {
    items.forEach((obj: T) => {
      addOrUpdateObject(this.objects, obj)
      if (obj.metadata!.namespace) {
        this.indexObj(obj)
      }
    })
  }

  private indexObj(obj: T): void {
    let namespaceList = this.indexCache[obj.metadata!.namespace!] as T[]
    if (!namespaceList) {
      namespaceList = []
      this.indexCache[obj.metadata!.namespace!] = namespaceList
    }
    addOrUpdateObject(namespaceList, obj)
  }
}

// external for testing
export function deleteItems<T extends KubernetesObject>(
  oldObjects: T[],
  newObjects: T[],
  deleteCallback?: Array<ObjectCallback<T>>
): T[] {
  return oldObjects.filter((obj: T) => {
    if (findKubernetesObject(newObjects, obj) === -1) {
      if (deleteCallback) {
        deleteCallback.forEach((fn: ObjectCallback<T>) => fn(obj))
      }
      return false
    }
    return true
  })
}

// Only public for testing.
export function addOrUpdateObject<T extends KubernetesObject>(objects: T[], obj: T): void {
  const ix = findKubernetesObject(objects, obj)
  if (ix === -1) {
    objects.push(obj)
  } else {
    if (!isSameVersion(objects[ix], obj)) {
      objects[ix] = obj
    }
  }
}

function isSameObject<T extends KubernetesObject>(o1: T, o2: T): boolean {
  return o1.metadata?.name === o2.metadata?.name && o1.metadata?.namespace === o2.metadata?.namespace
}

function findKubernetesObject<T extends KubernetesObject>(objects: T[], obj: T): number {
  return objects.findIndex((elt: T) => {
    return isSameObject(elt, obj)
  })
}

// Public for testing.
export function deleteObject<T extends KubernetesObject>(
  objects: T[],
  obj: T,
  deleteCallback?: Array<ObjectCallback<T>>
): void {
  const ix = findKubernetesObject(objects, obj)
  if (ix !== -1) {
    objects.splice(ix, 1)
    if (deleteCallback) {
      deleteCallback.forEach((elt: ObjectCallback<T>) => elt(obj))
    }
  }
}

function isSameVersion<T extends KubernetesObject>(o1: T, o2: T): boolean {
  return (
    o1.metadata?.resourceVersion !== undefined &&
    o1.metadata?.resourceVersion !== null &&
    o1.metadata?.resourceVersion === o2.metadata?.resourceVersion
  )
}
