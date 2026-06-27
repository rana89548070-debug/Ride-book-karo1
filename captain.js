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
const auth = firebase.auth(); // Auth instance initialized

// Initialize Map
var map = L.map('map').setView([28.9324, 79.4012], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Global State Variables
var routingControl = null;
var currentCaptainId = null; // Isme ab Firebase User UID standard save hoga
var targetRideId = null;
var activeFare = 0;
var confirmationResult = null; // OTP reference holder

// --- 📲 PHONE NUMBER LOGIN CONTROLLER ---

// Recaptcha Widget Initializer (Google security check for fake bots)
window.onload = function() {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        'size': 'invisible'
    });
    
    // Check if driver is already logged in session
    auth.onAuthStateChanged((user) => {
        if (user) {
            currentCaptainId = user.uid;
            document.getElementById('auth-box').style.display = 'none';
            checkCaptainDatabaseProfile(user.uid);
        }
    });
};

// 1. Send SMS OTP Function
function sendLoginOTP() {
    const phoneInput = document.getElementById('driver-phone').value.trim();
    if(!phoneInput.startsWith("+")) {
        alert("Please enter phone number with country code! (e.g., +919548xxxxxx)");
        return;
    }

    auth.signInWithPhoneNumber(phoneInput, window.recaptchaVerifier)
        .then((result) => {
            confirmationResult = result;
            alert("✅ Real SMS OTP sent successfully to your device!");
            document.getElementById('phone-entry-area').style.display = 'none';
            document.getElementById('otp-entry-area').style.display = 'block';
        }).catch((error) => {
            alert("SMS Gateway Error: " + error.message);
        });
}

// 2. Verify OTP & Fetch Account Session
function verifyLoginOTP() {
    const code = document.getElementById('login-otp-input').value.trim();
    if(code.length !== 6) {
        alert("Please enter a valid 6-Digit code.");
        return;
    }

    confirmationResult.confirm(code).then((result) => {
        const user = result.user;
        currentCaptainId = user.uid;
        alert("📲 Login Authenticated successfully!");
        document.getElementById('auth-box').style.display = 'none';
        
        // Check if Captain already has KYC or needs to register
        checkCaptainDatabaseProfile(user.uid);
    }).catch((error) => {
        alert("Invalid SMS OTP code! Try again: " + error.message);
    });
}

// 3. Database Check Profile Router
async function checkCaptainDatabaseProfile(uid) {
    const doc = await db.collection("captains").doc(uid).get();
    if(doc.exists) {
        const data = doc.data();
        document.getElementById('work-box').style.display = 'block';
        
        if(data.status === "pending") {
            document.getElementById('kyc-status').innerText = "⏳ Pending Approval";
            document.getElementById('kyc-status').style.background = "#ffc107";
            listenForApproval(uid);
        } else if(data.status === "approved") {
            document.getElementById('kyc-status').innerText = "🟢 Approved & Online";
            document.getElementById('kyc-status').style.background = "#28a745";
            document.getElementById('wallet-balance').innerText = data.walletBalance.toFixed(2) + " Rs";
            listenForAvailableRides();
        }
    } else {
        // First-time logged in user -> show KYC registration block
        document.getElementById('kyc-box').style.display = 'block';
    }
}

// --- 📝 4. KYC SUBMISSION FUNCTION (LINKED WITH USER UID) ---
async function submitKYC() {
    const nameInput = document.getElementById('cap-name');
    const vehicleInput = document.getElementById('cap-vehicle');
    
    if(!nameInput || !vehicleInput) return;

    const captainName = nameInput.value.trim();
    const vehicleNumber = vehicleInput.value.trim().toUpperCase(); 

    if(captainName === "") {
        alert("Please enter your Full Name!");
        return;
    }

    const vehicleRegex = /^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$/;
    if(!vehicleRegex.test(vehicleNumber)) {
        alert("🚨 Invalid Vehicle Number Format (e.g., UK02TB6475).");
        return;
    }

    try {
        // Is baar document random ID se add nahi hoga, balki driver ki permanent User UID `.doc(currentCaptainId)` standard par set hoga
        await db.collection("captains").doc(currentCaptainId).set({
            name: captainName,
            vehicle: vehicleNumber,
            status: "pending",
            walletBalance: 500,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert("✅ KYC Submitted Successfully to Admin Panel!");
        document.getElementById('kyc-box').style.display = 'none';
        document.getElementById('work-box').style.display = 'block';
        document.getElementById('kyc-status').innerText = "⏳ Pending Approval";
        document.getElementById('kyc-status').style.background = "#ffc107";

        listenForApproval(currentCaptainId);

    } catch (error) {
        alert("KYC Submission Error: " + error.message);
    }
}

// --- 5. ADMIN APPROVAL LISTENER ---
function listenForApproval(captainId) {
    db.collection("captains").doc(captainId).onSnapshot((doc) => {
        const data = doc.data();
        if (data && data.status === "approved") {
            alert("🎉 Badhai ho! Aapka KYC Approve ho gaya hai.");
            document.getElementById('kyc-status').innerText = "🟢 Approved & Online";
            document.getElementById('kyc-status').style.background = "#28a745";
            document.getElementById('wallet-balance').innerText = data.walletBalance.toFixed(2) + " Rs";
            listenForAvailableRides();
        }
    });
}

// --- 6. LIVE RIDE REQUEST SEARCH ---
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

// --- 7. ACCEPT RIDE FUNCTION ---
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

// --- 8. OTP VERIFICATION ENGINE ---
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

// --- 9. END TRIP ENGINE ---
async function endCurrentTrip() {
    const commissionRate = 0.07;
    const cutAmount = activeFare * commissionRate;
    await db.collection("captains").doc(currentCaptainId).update({ walletBalance: firebase.firestore.FieldValue.increment(-cutAmount) });
    await db.collection("admin_analytics").doc("revenue").set({ totalCommissionEarned: firebase.firestore.FieldValue.increment(cutAmount) }, { merge: true });
    await db.collection("rides").doc(targetRideId).update({ status: "completed" });
    alert(`Collected ${activeFare} Rs.`);
    location.reload();
}
