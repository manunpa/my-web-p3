import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from './firebase'

// Writes the signed-in user to Firestore at users/{uid}.
// Safe to call many times: it merges, and `createdAt` comes from Firebase Auth,
// so it never changes. A brand-new sign-up shows up in the `users` collection
// right away (sort by createdAt in the Firebase Console to see the newest).
export async function saveUser(user) {
  const provider = user.providerData[0]?.providerId ?? 'password'
  const isNew = user.metadata.creationTime === user.metadata.lastSignInTime

  try {
    await setDoc(
      doc(db, 'users', user.uid),
      {
        uid: user.uid,
        email: user.email ?? null,
        name: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        provider,
        createdAt: Timestamp.fromDate(new Date(user.metadata.creationTime)),
        lastSeenAt: serverTimestamp(),
      },
      { merge: true },
    )
    if (isNew) console.info('New user saved to Firestore:', user.email)
  } catch (err) {
    // Never block sign-in because of the database; just report it.
    console.error('Could not save user to Firestore:', err)
  }
}
