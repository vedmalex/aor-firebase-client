/* globals localStorage */
import { AUTH_LOGIN, AUTH_LOGOUT, AUTH_CHECK } from './reference';
import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/database';

export interface AuthConfig<T = any> {
  userProfilePath: string;
  userAdminProp: string;
  localStorageTokenName: string;
  handleAuthStateChange: (
    auth: firebase.User,
    config: AuthConfig,
  ) => Promise<UserInfo<T>>;
}

export interface UserInfo<T = any> {
  auth: firebase.User;
  profile: T;
  firebaseToken: string;
}

const baseConfig: AuthConfig = {
  userProfilePath: 'users',
  userAdminProp: 'isAdmin',
  localStorageTokenName: 'ra-data-firestore',
  handleAuthStateChange: async (auth: firebase.User, config: AuthConfig) => {
    console.log(`auth`, auth);
    if (auth) {
      const snapshot = await firebase
        .firestore()
        .collection(config.userProfilePath)
        .doc(auth.uid)
        .get();
      const profile = snapshot.data();

      if (profile && profile[config.userAdminProp]) {
        const firebaseToken = await auth.getIdToken();
        let user = { auth, profile, firebaseToken };
        localStorage.setItem(config.localStorageTokenName, firebaseToken);
        return user;
      } else {
        firebase.auth().signOut();
        localStorage.removeItem(config.localStorageTokenName);
        throw new Error('sign_in_error');
      }
    } else {
      localStorage.removeItem(config.localStorageTokenName);
      throw new Error('sign_in_error');
    }
  },
};

function authConfig(config: AuthConfig) {
  config = { ...baseConfig, ...config };

  const firebaseLoaded = () =>
    new Promise(resolve => {
      firebase.auth().onAuthStateChanged(resolve);
    });

  return async (type, params) => {
    if (type === AUTH_LOGOUT) {
      config.handleAuthStateChange(null, config).catch(() => {});
      return firebase.auth().signOut();
    }

    if (firebase.auth().currentUser) {
      await firebase.auth().currentUser.reload();
    }

    if (type === AUTH_CHECK) {
      await firebaseLoaded();

      if (!firebase.auth().currentUser) {
        throw new Error('sign_in_error');
      }

      return true;
    }

    if (type === AUTH_LOGIN) {
      const { username, password, alreadySignedIn } = params;
      let auth = firebase.auth().currentUser;

      if (!auth || !alreadySignedIn) {
        auth = (
          await firebase.auth().signInWithEmailAndPassword(username, password)
        ).user;
      }

      return config.handleAuthStateChange(auth, config);
    }

    return false;
  };
}

export default authConfig;
