import DataProvider, { dataProviderConfig } from './dataProviderV3';
import * as firebase from 'firebase-admin';

export default class extends DataProvider {
  constructor({ timestampFieldNames, trackedResources }: dataProviderConfig) {
    super({
      firestore: firebase.firestore() as any,
      storage: firebase.storage() as any,
      // что-то придумать с этим
      // getUser: () => firebase.auth().currentUser,
      timestampFieldNames,
      trackedResources,
    });
  }
}
