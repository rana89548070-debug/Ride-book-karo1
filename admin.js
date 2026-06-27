// --- ADMIN CORE LOGIC ENGINE ---
const firebaseConfig = {
  apiKey: "AIzaSyBgmr-RNHwzrtvlELXi5OQCFco6hds6o2w",
  authDomain: "ride-book-karo-e83fd.firebaseapp.com",
  databaseURL: "https://ride-book-karo-e83fd-default-rtdb.firebaseio.com",
  projectId: "ride-book-karo-e83fd",
  storageBucket: "ride-book-karo-e83fd.firebasestorage.app",
  messagingSenderId: "132089297625",
  appId: "1:132089297625:web:1cc6b4236b6918312c9cc8"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 1. Live Listen Pending Captains
db.collection("captains").where("status", "==", "pending")
.onSnapshot((snapshot) => {
    const listDiv = document.getElementById("kyc-requests-list");
    if(!listDiv) return;

    if(snapshot.empty) {
        listDiv.innerHTML = `<p style="color: #6c757d;">No pending KYC requests at the moment.</p>`;
        return;
    }

    listDiv.innerHTML = ""; 
    snapshot.forEach((doc) => {
        const captain = doc.data();
        const id = doc.id;

        listDiv.innerHTML += `
            <div class="kyc-card" style="border-left: 5px solid #ffc107; background: #fff; padding: 12px; margin: 10px 0; border-radius: 4px; color:#333; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <p style="margin:4px 0;"><strong>Driver Name:</strong> ${captain.name}</p>
                <p style="margin:4px 0;"><strong>Vehicle No:</strong> ${captain.vehicle}</p>
                <button onclick="approveCaptain('${id}')" style="background:#28a745; color:white; border:none; padding:6px 12px; border-radius:3px; font-weight:bold; cursor:pointer; margin-top:5px;">Approve KYC Now</button>
            </div>
        `;
    });
});

// 2. Approve Function
async function approveCaptain(id) {
    try {
        await db.collection("captains").doc(id).update({ status: "approved" });
        alert("Captain successfully verified!");
    } catch(e) { alert("Error: " + e.message); }
}

// 3. Live Revenue Listener
db.collection("admin_analytics").doc("revenue").onSnapshot((doc) => {
    const revSpan = document.getElementById("admin-revenue");
    if(revSpan && doc.exists) {
        revSpan.innerText = doc.data().totalCommissionEarned.toFixed(2) + " Rs";
    }
});
