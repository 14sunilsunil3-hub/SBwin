const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// JSON parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (index.html, images, CSS, JS) from root directory
app.use(express.static(path.join(__dirname)));

// Dummy user state (In-memory storage)
let userData = {
  uid: "98314201",
  username: "Member_8921",
  vipLevel: 3,
  balance: 0.11,
  safeBalance: 0.00
};

// API 1: Get User Profile & Wallet Details
app.get('/api/user', (req, res) => {
  res.json({
    success: true,
    data: userData
  });
});

// API 2: Spin Wheel Reward Endpoint
app.post('/api/spin-wheel', (req, res) => {
  const winAmount = 500.00;
  userData.balance += winAmount;

  res.json({
    success: true,
    message: `Congratulations! You won ₹${winAmount} Bonus Cash!`,
    newBalance: userData.balance.toFixed(2)
  });
});

// API 3: Daily Activity Claim
app.post('/api/claim-daily', (req, res) => {
  const bonus = 10.00;
  userData.balance += bonus;

  res.json({
    success: true,
    message: `Claimed ₹${bonus} Daily Bonus!`,
    newBalance: userData.balance.toFixed(2)
  });
});

// Catch-all route to serve index.html for any frontend path
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`🚀 SBwin Server running on port ${PORT}`);
  console.log(`=================================`);
});
