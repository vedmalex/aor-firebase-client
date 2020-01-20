import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';
import 'firebase/storage';

export default function (client) {
  if (firebase.apps.length === 0) {
    firebase.initializeApp(client);
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION);
  }
  return firebase;
}
