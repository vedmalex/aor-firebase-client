import DataProvider, { dataProviderConfig } from './dataProviderV3';
import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';
import 'firebase/storage';

export default class extends DataProvider {
  constructor({ timestampFieldNames, trackedResources }: dataProviderConfig) {
    super({
      firestore: firebase.firestore(),
      storage: firebase.storage(),
      getUser: () => firebase.auth().currentUser,
      timestampFieldNames,
      trackedResources,
    });
  }
}
