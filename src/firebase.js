import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// These values are public identifiers, not secrets.
// Real protection comes from Firebase Authentication and its rules.
const firebaseConfig = {
  apiKey: "AIzaSyA5OM2om_4CnwTuFAixQGwxhtyUUmDjv7Y",
  authDomain: "my-web-p3.firebaseapp.com",
  projectId: "my-web-p3",
  storageBucket: "my-web-p3.firebasestorage.app",
  messagingSenderId: "64927747794",
  appId: "1:64927747794:web:f18c6d1dbcfb932166270b",
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
