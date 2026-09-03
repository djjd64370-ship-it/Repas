import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// 👉 Remplacez ces valeurs par celles de VOTRE projet Firebase
// (Console Firebase > Paramètres du projet > Vos applications > Config SDK)
const firebaseConfig = {
  apiKey: "AIzaSyAcYzbUmjuDvxTKsv4ASytStx3brV4zLvM",
  authDomain: "repas-duarte.firebaseapp.com",
  projectId: "repas-duarte",
  storageBucket: "repas-duarte.firebasestorage.app",
  messagingSenderId: "789391296380",
  appId: "G-YNKNMWR07R",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
