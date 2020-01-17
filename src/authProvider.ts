import * as firebase from 'firebase/app';
import 'firebase/auth';

const firebaseLoaded = () =>
  new Promise(resolve => {
    firebase.auth().onAuthStateChanged(resolve);
  });

export default (persistence: firebase.auth.Auth.Persistence) => ({
  login: ({ username, password }) =>
    firebase
      .auth()
      .setPersistence(persistence || firebase.auth.Auth.Persistence.LOCAL)
      .then(() =>
        firebase.auth().signInWithEmailAndPassword(username, password),
      ),
  logout: () => firebase.auth().signOut(),
  checkAuth: () => {
    firebaseLoaded().then(() => {
      if (firebase.auth().currentUser) {
        return firebase.auth().currentUser.reload();
      } else {
        return Promise.reject();
      }
    });
  },
  checkError: (error: { code: string; message: string }) =>
    Promise.resolve(error.message),
  getPermissions: () =>
    firebase.auth().currentUser
      ? firebase
          .auth()
          .currentUser.getIdTokenResult()
          .then(result => result.claims)
      : Promise.reject(),
});
