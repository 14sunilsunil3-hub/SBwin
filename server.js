const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dns = require('dns');
const path = require('path');

const { initWinGoGame, gameStates } = require('./game-logic/wingoGame');

try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (error) {
    console.log("DNS setting error:", error);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

app.use(express.static(path.join(__dirname)));

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/deposit-admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'deposit-admin.html'));
});

app.get('/withdraw.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'withdraw.html'));
});

const MONGO_URI = "mongodb+srv://14sunilsunil3_db_user:W1LlrneQfi7toLpn@cluster1.pr9b0cx.mongodb.net/sbwin_db?retryWrites=true&w=majority";

function generateUID() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const userSchema = new mongoose.Schema({
    uid: { type: String, unique: true, default: generateUID },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 }, 
    winningsBalance: { type: Number, default: 0 }, 
    totalBetDone: { type: Number, default: 0 }, 
    lastLoginTime: { type: Date, default: null }, 
    referredBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const gameResultSchema = new mongoose.Schema({
    timerType: { type: String, default: '30s' }, 
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    color: { type: String, required: true },
    size: { type: String },
    createdAt: { type: Date, default: Date.now }
});
const GameResult = mongoose.model('GameResult', gameResultSchema);

const betSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timerType: { type: String, default: '30s' },
    period: String,
    betType: String, 
    betValue: String, 
    amount: Number,
    status: { type: String, default: 'pending' }, 
    payout: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const Bet = mongoose.model('Bet', betSchema);

const manualOverrideSchema = new mongoose.Schema({
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    used: { type: Boolean, default: false }
});
const ManualOverride = mongoose.model('ManualOverride', manualOverrideSchema);

const depositSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    utr: String,
    orderNo: { type: String, unique: true },
    rejectReason: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

const withdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    accountHolderName: String,
    upiId: String,
    bankName: String,
    accountNumber: String,
    ifsc: String,
    mobile: String,
    orderNo: { type: String, unique: true },
    type: { type: String, default: 'BANK CARD' },
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

const ADMIN_NUMBERS = ["8093361993", "+918093361993", "918093361993"];

async function setupAdminAccount() {
    try {
        const adminPhone = "8093361993";
        const adminPassword = "14butu3";

        let adminUser = await User.findOne({ phone: adminPhone });
        if (!adminUser) {
            adminUser = new User({
                phone: adminPhone,
                password: adminPassword,
                balance: 100,
                winningsBalance: 0
            });
            await adminUser.save();
        }
    } catch (err) {
        console.error("Admin setup error:", err.message);
    }
}

const activeOnlineSocketUsers = new Set();

function startMidnightResetChecker() {
    setInterval(async () => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            try {
                const allUsers = await User.find({});
                for (const u of allUsers) {
                    if (!activeOnlineSocketUsers.has(u._id.toString())) {
                        u.lastLoginTime = null;
                        await u.save();
                    }
                }
            } catch (err) {}
            await new Promise(resolve => setTimeout(resolve, 70000));
        }
    }, 10000);
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'auth.html'));
});

// ==========================================
// SECURE SERVER-SIDE ADMIN APIs
// ==========================================
app.post('/api/admin/verify', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.json({ success: true, isAdmin: false });
        const user = await User.findById(userId);
        if (!user) return res.json({ success: true, isAdmin: false });
        const isAdmin = ADMIN_NUMBERS.includes(user.phone);
        res.json({ success: true, isAdmin });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/live-bets', async (req, res) => {
    try {
        const { period, timerType, userId } = req.query;
        const user = await User.findById(userId);
        if (!user || !ADMIN_NUMBERS.includes(user.phone)) {
            return res.status(403).json({ success: false, message: 'Access Denied: Admin only!' });
        }

        const bets = await Bet.find({ period, timerType, status: 'pending' });
        let totals = {
            'Red': 0, 'Violet': 0, 'Green': 0,
            '0': 0, '1': 0, '2': 0, '3': 0, '4': 0,
            '5': 0, '6': 0, '7': 0, '8': 0, '9': 0,
            'Big': 0, 'Small': 0
        };

        bets.forEach(bet => {
            let val = String(bet.betValue).trim();
            let lowerVal = val.toLowerCase();
            
            if (lowerVal === 'red') val = 'Red';
            else if (lowerVal === 'green') val = 'Green';
            else if (lowerVal === 'violet') val = 'Violet';
            else if (lowerVal === 'big') val = 'Big';
            else if (lowerVal === 'small') val = 'Small';

            if (totals[val] !== undefined) {
                totals[val] += bet.amount;
            }
        });

        res.json({ success: true, totals });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/admin/set-override', async (req, res) => {
    try {
        const { period, timerType, number, userId } = req.body;
        const user = await User.findById(userId);
        if (!user || !ADMIN_NUMBERS.includes(user.phone)) {
            return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required!' });
        }

        const currentState = gameStates[timerType];
        if (currentState && currentState.countdown <= 1) {
            return res.status(400).json({ success: false, message: 'Too late! Last 1 second reached.' });
        }

        await ManualOverride.deleteMany({ period });
        const newOverride = new ManualOverride({ period, timerType, number, used: false });
        await newOverride.save();
        res.json({ success: true, message: 'Override set successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to set override' });
    }
});

// ==========================================
// ADMIN REQUESTS & ACTION APIs
// ==========================================
app.get('/api/admin/requests', async (req, res) => {
    try {
        const deposits = await Deposit.find({})
            .populate('userId', 'phone uid balance winningsBalance')
            .sort({ createdAt: -1 });

        const withdrawals = await Withdrawal.find({})
            .populate('userId', 'phone uid balance winningsBalance')
            .sort({ createdAt: -1 });

        res.json({ success: true, deposits, withdrawals });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/action', async (req, res) => {
    try {
        const { type, id, action, reason } = req.body;

        if (!['deposit', 'withdrawal'].includes(type) || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid type or action!" });
        }

        if (type === 'deposit') {
            const deposit = await Deposit.findById(id);
            if (!deposit) {
                return res.status(404).json({ success: false, message: "Deposit request not found!" });
            }
            if (deposit.status !== 'pending') {
                return res.status(400).json({ success: false, message: "Deposit already processed!" });
            }

            if (action === 'approve') {
                deposit.status = 'approved';
                await deposit.save();

                const user = await User.findById(deposit.userId);
                if (user) {
                    user.balance = (Number(user.balance) || 0) + Number(deposit.amount);
                    await user.save();
                }
                return res.json({ success: true, message: "Deposit approved and balance updated!" });
            }

            if (action === 'reject') {
                deposit.status = 'rejected';
                deposit.rejectReason = reason || 'Rejected by admin';
                await deposit.save();
                return res.json({ success: true, message: "Deposit rejected!" });
            }
        }

        if (type === 'withdrawal') {
            const withdrawal = await Withdrawal.findById(id);
            if (!withdrawal) {
                return res.status(404).json({ success: false, message: "Withdrawal request not found!" });
            }
            if (withdrawal.status !== 'pending') {
                return res.status(400).json({ success: false, message: "Withdrawal already processed!" });
            }

            if (action === 'approve') {
                withdrawal.status = 'approved';
                await withdrawal.save();
                return res.json({ success: true, message: "Withdrawal approved!" });
            }

            if (action === 'reject') {
                withdrawal.status = 'rejected';
                await withdrawal.save();

                const user = await User.findById(withdrawal.userId);
                if (user) {
                    user.winningsBalance = (Number(user.winningsBalance) || 0) + Number(withdrawal.amount);
                    await user.save();
                }
                return res.json({ success: true, message: "Withdrawal rejected and balance refunded!" });
            }
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// DEPOSIT APIs
// ==========================================
app.post('/api/deposit', async (req, res) => {
    try {
        const { userId, amount, utr, orderNo } = req.body;
        if (!userId || !amount || !utr) {
            return res.status(400).json({ success: false, message: "All fields are required!" });
        }
        const newDeposit = new Deposit({
            userId,
            amount: Number(amount),
            utr,
            orderNo: orderNo || ('SBW' + Math.floor(100000 + Math.random() * 900000)),
            status: 'pending'
        });
        await newDeposit.save();
        res.json({ success: true, message: "Deposit request submitted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user-deposits/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const deposits = await Deposit.find({ userId }).sort({ createdAt: -1 }).limit(20);
        res.json({ success: true, deposits });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// USER & GAME APIs
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, refUid } = req.body;
        if (!phone || !password) return res.status(400).json({ success: false, message: "Phone and password required!" });

        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ success: false, message: "This phone number is already registered!" });

        const newUser = new User({ 
            phone, 
            password, 
            balance: 0, 
            winningsBalance: 0,
            lastLoginTime: new Date(), 
            referredBy: refUid || null 
        });

        await newUser.save();
        res.json({ success: true, message: "Registration successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone, password });
        if (!user) return res.status(400).json({ success: false, message: "Invalid phone number or password!" });

        user.lastLoginTime = new Date();
        await user.save();

        const isAdmin = ADMIN_NUMBERS.includes(phone);

        res.json({ 
            success: true, 
            message: "Login successful!", 
            userId: user._id, 
            balance: user.balance,
            winningsBalance: user.winningsBalance,
            isAdmin: isAdmin,
            user: { 
                _id: user._id, 
                uid: user.uid,
                phone: user.phone, 
                balance: user.balance, 
                winningsBalance: user.winningsBalance,
                totalBetDone: user.totalBetDone || 0,
                isAdmin: isAdmin
            } 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        const isAdmin = ADMIN_NUMBERS.includes(user.phone);
        res.json({ success: true, balance: user.balance, winningsBalance: user.winningsBalance, totalBetDone: user.totalBetDone || 0, isAdmin, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/game-history/:timerType', async (req, res) => {
    try {
        const { timerType } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const total = await GameResult.countDocuments({ timerType });
        const history = await GameResult.find({ timerType }).sort({ _id: -1 }).skip(skip).limit(limit);
        
        res.json({ success: true, history, totalPages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user-bets/:userId/:timerType', async (req, res) => {
    try {
        const { userId, timerType } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const total = await Bet.countDocuments({ userId, timerType });
        const bets = await Bet.find({ userId, timerType }).sort({ createdAt: -1 }).skip(skip).limit(limit);

        res.json({ success: true, bets, totalPages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user-round-result', async (req, res) => {
    try {
        const { userId, period, timerType } = req.query;
        if (!userId || !period) return res.json({ success: false, hasBet: false });

        const bet = await Bet.findOne({ userId, period, timerType, status: { $ne: 'pending' } });
        if (!bet) {
            return res.json({ success: true, hasBet: false });
        }

        const gameResult = await GameResult.findOne({ period, timerType });

        res.json({
            success: true,
            hasBet: true,
            betData: {
                status: bet.status, 
                amount: bet.amount,
                payout: bet.payout || 0,
                period: bet.period,
                number: gameResult ? gameResult.number : 0,
                color: gameResult ? gameResult.color : 'green',
                size: gameResult ? gameResult.size : 'Big'
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/bet', async (req, res) => {
    try {
        const { userId, timerType = '30s', period, betType, betValue, amount } = req.body;
        
        if (!gameStates[timerType] || !gameStates[timerType].isBettingOpen || gameStates[timerType].countdown <= 5) {
            return res.status(400).json({ success: false, message: "Betting is closed for this period (Last 5s)!" });
        }

        const user = await User.findById(userId);
        const totalUserBal = (user.balance || 0) + (user.winningsBalance || 0);
        if (!user || totalUserBal < Number(amount)) {
            return res.status(400).json({ success: false, message: "Insufficient balance!" });
        }

        let deductAmt = Number(amount);
        if (user.balance >= deductAmt) {
            user.balance -= deductAmt;
        } else {
            let remain = deductAmt - user.balance;
            user.balance = 0;
            user.winningsBalance -= remain;
        }

        user.totalBetDone = (user.totalBetDone || 0) + deductAmt;
        await user.save();

        const newBet = new Bet({ userId, timerType, period, betType, betValue, amount: deductAmt });
        await newBet.save();

        res.json({ success: true, message: "Bet successfully added!", newBalance: user.balance, newWinnings: user.winningsBalance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('*', (req, res) => {
  const reqPath = req.path;
  if (reqPath.startsWith('/games/')) {
    res.sendFile(path.join(__dirname, reqPath));
  } else if (reqPath.startsWith('/in-out/')) {
    res.sendFile(path.join(__dirname, reqPath));
  } else {
    const cleanPath = reqPath.substring(1) || 'index.html';
    const rootFile = path.join(__dirname, cleanPath);
    res.sendFile(rootFile, (err) => {
      if (err) {
        res.sendFile(path.join(__dirname, 'index.html'));
      }
    });
  }
});

mongoose.connect(MONGO_URI).then(async () => {
    console.log("Connected to MongoDB successfully!");
    await setupAdminAccount();
    startMidnightResetChecker();
    initWinGoGame(io, GameResult, Bet, ManualOverride, User);
}).catch(err => {
    console.error("MongoDB connection error:", err);
});

io.on('connection', (socket) => {
    let currentConnectedUserId = null;

    socket.on('registerUserSession', (userId) => {
        currentConnectedUserId = userId;
        if (userId) activeOnlineSocketUsers.add(userId);
    });

    socket.on('disconnect', () => {
        if (currentConnectedUserId) {
            setTimeout(() => activeOnlineSocketUsers.delete(currentConnectedUserId), 10000);
        }
    });

    ['30s', '60s', '3m', '5m'].forEach(type => {
        socket.emit(`timerTick_${type}`, { 
            countdown: gameStates[type].countdown, isBettingOpen: gameStates[type].isBettingOpen, period: gameStates[type].period 
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log('==================================');
    console.log(`🚀 SBWin Server running on port ${PORT}`);
    console.log('==================================');
});
