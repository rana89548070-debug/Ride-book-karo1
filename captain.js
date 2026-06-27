// --- FIREBASE CONFIGURATION ---
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

// Initialize Map
var map = L.map('map').setView([28.9324, 79.4012], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var routingControl = null;
var currentCaptainId = null;
var targetRideId = null;
var activeFare = 0;

// 🎯 KYC SUBMISSION FUNCTION
async function SubmitKYC() {
    const nameInput = document.getElementById('cap-name');
    const vehicleInput = document.getElementById('cap-vehicle');
    
    if(!nameInput || !vehicleInput) {
        alert("🚨 System Error: HTML input IDs (cap-name or cap-vehicle) missing!");
        return;
    }

    const captainName = nameInput.value.trim();
    const vehicleNumber = vehicleInput.value.trim().toUpperCase(); 

    if(captainName === "") {
        alert("Please enter your Full Name!");
        return;
    }

    // STRICT VEHICLE FORMAT REGEX
    const vehicleRegex = /^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$/;
    if(!vehicleRegex.test(vehicleNumber)) {
        alert("🚨 Invalid Vehicle Number! Enter format like UK02TB6475 or UK06AA1111.");
        return;
    }

    try {
        const btn = document.querySelector('button[onclick*="submitKYC"]') || document.querySelector('button[onclick*="SubmitKYC"]');
        if(btn) btn.innerText = "Submitting...";

        // Insert into Firestore
        const captainRef = await db.collection("captains").add({
            name: captainName,
            vehicle: vehicleNumber,
            status: "pending",
            walletBalance: 500,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        currentCaptainId = captainRef.id;
        alert("✅ KYC Submitted Successfully! Checking Admin Console...");

        // Safe UI Toggle
        const kycBox = document.getElementById('kyc-box');
        const workBox = document.getElementById('work-box');
        if(kycBox) kycBox.style.display = 'none';
        if(workBox) {
            workBox.style.display = 'block';
            const statusBadge = document.getElementById('kyc-status');
            if(statusBadge) {
                statusBadge.innerText = "⏳ Pending Approval";
                statusBadge.style.background = "#ffc107";
            }
        }

        listenForApproval(currentCaptainId);

    } catch (error) {
        alert("KYC Insertion Error: " + error.message);
    }
}

function listenForApproval(captainId) {
    db.collection("captains").doc(captainId).onSnapshot((doc) => {
        const data = doc.data();
        if (data && data.status === "approved") {
            alert("🎉 Approved! You are now online.");
            const statusBadge = document.getElementById('kyc-status');
            if(statusBadge) {
                statusBadge.innerText = "🟢 Approved & Online";
                statusBadge.style.background = "#28a745";
            }
            const walletSpan = document.getElementById('wallet-balance');
            if(walletSpan) walletSpan.innerText = data.walletBalance.toFixed(2) + " Rs";
            listenForAvailableRides();
        }
    });
}

function listenForAvailableRides() {
    db.collection("rides").where("status", "==", "pending").limit(1).onSnapshot((snapshot) => {
        if(!snapshot.empty && !targetRideId) {
            const rideDoc = snapshot.docs[0];
            const data = rideDoc.data();
            targetRideId = rideDoc.id;
            activeFare = data.fare;

            const jobPanel = document.getElementById("job-panel");
            if(jobPanel) {
                jobPanel.innerHTML = `
                    <hr>
                    <p style="color:#007bff; font-weight:bold;">New Ride Request Received!</p>
                    <div>Distance: <strong>${data.distance} km</strong></div>
                    <div>Fare: <strong>${data.fare} Rs</strong></div>
                    <button onclick="acceptIncomingRide()" style="background:#28a745; color:white; border:none; padding:10px; width:100%; border-radius:5px; font-weight:bold; cursor:pointer; margin-top:10px;">Accept Ride Request</button>
                `;
                jobPanel.style.display = "block";
            }
        }
    });
}

async function acceptIncomingRide() {
    try {
        const rideDoc = await db.collection("rides").doc(targetRideId).get();
        const rideData = rideDoc.data();
        await db.collection("rides").doc(targetRideId).update({ status: "accepted", driverId: currentCaptainId });

        const jobPanel = document.getElementById("job-panel");
        if(jobPanel) {
            jobPanel.innerHTML = `
                <p style="font-weight:bold; color:#ffc107;">Status: Heading to Pickup</p>
                <div style="margin-top:10px; display:flex; gap:5px;">
                    <input type="text" id="otp-input" placeholder="Enter OTP" style="padding:8px; flex:1;">
                    <button onclick="verifyOtpAndStartTrip()" style="padding:8px; background:#007bff; color:white; border:none; font-weight:bold;">Verify</button>
                </div>
            `;
        }
        navigator.geolocation.getCurrentPosition((pos) => {
            if (routingControl) map.removeControl(routingControl);
            routingControl = L.Routing.control({
                waypoints: [L.latLng(pos.coords.latitude, pos.coords.longitude), L.latLng(rideData.pickup.lat, rideData.pickup.lng)],
                addWaypoints: false
            }).addTo(map);
        });
    } catch (e) { alert("Error: " + e.message); }
}

async function verifyOtpAndStartTrip() {
    const enteredOtp = document.getElementById("otp-input").value.trim();
    const rideDoc = await db.collection("rides").doc(targetRideId).get();
    const rideData = rideDoc.data();
    
    if (enteredOtp === rideData.otp) {
        await db.collection("rides").doc(targetRideId).update({ status: "ongoing" });
        const jobPanel = document.getElementById("job-panel");
        if(jobPanel) {
            jobPanel.innerHTML = `
                <p style="color:#28a745; font-weight:bold;">Trip Active</p>
                <button onclick="endCurrentTrip()" style="background:#dc3545; color:white; border:none; padding:10px; width:100%; border-radius:5px; font-weight:bold; cursor:pointer; margin-top:10px;">End Ride & Collect ${activeFare} Rs</button>
            `;
        }
        if (routingControl) map.removeControl(routingControl);
        routingControl = L.Routing.control({
            waypoints: [L.latLng(rideData.pickup.lat, rideData.pickup.lng), L.latLng(rideData.drop.lat, rideData.drop.lng)],
            addWaypoints: false
        }).addTo(map);
    } else { alert("Invalid OTP!"); }
}

async function endCurrentTrip() {
    const commissionRate = 0.07;
    const cutAmount = activeFare * commissionRate;
    await db.collection("captains").doc(currentCaptainId).update({ walletBalance: firebase.firestore.FieldValue.increment(-cutAmount) });
    await db.collection("admin_analytics").doc("revenue").set({ totalCommissionEarned: firebase.firestore.FieldValue.increment(cutAmount) }, { merge: true });
    await db.collection("rides").doc(targetRideId).update({ status: "completed" });
    alert(`Collected ${activeFare} Rs.`);
    location.reload();
}
