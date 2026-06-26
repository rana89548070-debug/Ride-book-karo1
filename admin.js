const firebaseConfig = {
    apiKey: "AIzaSyAs-YOUR-ACTUAL-API-KEY",
    authDomain: "ride-book-karo-e83fd.firebaseapp.com",
    projectId: "ride-book-karo-e83fd",
    storageBucket: "ride-book-karo-e83fd.appspot.com",
    messagingSenderId: "YOUR-SENDER-ID",
    appId: "YOUR-APP-ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 1. Real-time platform commission earnings monitor
db.collection("admin_analytics").doc("revenue").onSnapshot((doc) => {
    if(doc.exists) {
        document.getElementById("admin-revenue").innerText = doc.data().totalCommissionEarned.toFixed(2) + " Rs";
    }
});

// 2. Real-time watch for captains submitting KYC data
db.collection("captains").where("kycStatus", "==", "pending")
  .onSnapshot((snapshot) => {
      const container = document.getElementById("kyc-requests-list");
      container.innerHTML = "";

      if(snapshot.empty) {
          container.innerHTML = `<p style="color: #6c757d;">No pending KYC requests at the moment.</p>`;
          return;
      }

      snapshot.forEach((doc) => {
          const cap = doc.data();
          const capId = doc.id;

          const row = document.createElement("div");
          row.className = "box";
          row.style.borderLeftColor = "#ffc107";
          row.innerHTML = `
              <div class="data-row"><span>Name:</span><strong>${cap.name}</strong></div>
              <div class="data-row"><span>Vehicle:</span><strong>${cap.vehicleNo}</strong></div>
              <button style="background:#28a745; margin-top:10px;" onclick="approveCaptain('${capId}')">Approve KYC Now</button>
          `;
          container.appendChild(row);
      });
  });

async function approveCaptain(id) {
    await db.collection("captains").doc(id).update({
        kycStatus: "approved"
    });
    alert("Captain Account Activated on Network Securely!");
}
