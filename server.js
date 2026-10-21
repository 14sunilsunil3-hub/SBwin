const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dns = require('dns');
const crypto = require('crypto');
const path = require('path');

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

// Serve static files from root directory[span_1](start_span)[span_1](end_span)
app.use(express.static(path.join(__dirname)));

// Explicit routes to prevent 404 Not Found errors on Render[span_2](start_span)[span_2](end_span)
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

// User Schema - Permanent Database Storage[span_3](start_span)[span_3](end_span)
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

// Admin Numbers Configuration[span_4](start_span)[span_4](end_span)
const ADMIN_NUMBERS = ["8093361993", "+918093361993", "918093361993"];

async function setupAdminAccount() {
    try {
        const adminPhone = "8093361993";
        const adminPassword = "Admin123";

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

function getPeriodCodeForTime(timerType, timestamp = Date.now()) {
    const now = new Date(timestamp);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const elapsedSeconds = Math.floor((now.getTime() - startOfDay) / 1000);

    let intervalSeconds = 30;
    let gamePrefix = '1';
    if (timerType === '60s' || timerType === '1m') { intervalSeconds = 60; gamePrefix = '2'; }
    else if (timerType === '3m') { intervalSeconds = 180; gamePrefix = '3'; }
    else if (timerType === '5m') { intervalSeconds = 300; gamePrefix = '5'; }

    const periodNumber = Math.floor(elapsedSeconds / intervalSeconds) + 1;

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `${year}${month}${day}${gamePrefix}${String(periodNumber).padStart(5, '0')}`;
}

const gameStates = {
    '30s': { countdown: 29, isBettingOpen: true, period: '', startTime: 0 },
    '60s': { countdown: 59, isBettingOpen: true, period: '', startTime: 0 },
    '3m':  { countdown: 179, isBettingOpen: true, period: '', startTime: 0 },
    '5m':  { countdown: 299, isBettingOpen: true, period: '', startTime: 0 }
};

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
                console.log("Midnight 12 AM reset executed successfully.");
            } catch (err) {
                console.error("Midnight reset error:", err.message);
            }
            await new Promise(resolve => setTimeout(resolve, 70000));
        }
    }, 10000);
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'auth.html'));
});

// Registration API[span_5](start_span)[span_5](end_span)
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

app.post('/api/check-session', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.json({ success: false, valid: false });

        const user = await User.findById(userId);
        if (!user || !user.lastLoginTime) {
            return res.json({ success: true, valid: false, message: "Session expired or logged out after midnight." });
        }

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const loginTimestamp = new Date(user.lastLoginTime).getTime();

        if (loginTimestamp >= startOfToday) {
            return res.json({ success: true, valid: true });
        } else {
            return res.json({ success: true, valid: false, message: "Please log in again after midnight reset." });
        }
    } catch (err) {
        res.status(500).json({ success: false, valid: false, message: err.message });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { phone, newPassword } = req.body;
        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ success: false, message: "Phone number not registered!" });

        user.password = newPassword;
        user.lastLoginTime = null; 
        await user.save();

        res.json({ success: true, message: "Password reset successful!" });
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

app.get('/api/user/mobile/:mobile', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.mobile });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        const isAdmin = ADMIN_NUMBERS.includes(user.phone);
        res.json({ success: true, isAdmin, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user-deposits/:userId', async (req, res) => {
    try {
        const deposits = await Deposit.find({ userId: req.params.userId }).sort({ createdAt: -1 });
        res.json({ success: true, deposits });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Deposit API[span_6](start_span)[span_6](end_span)
app.post('/api/deposit', async (req, res) => {
    try {
        const { userId, amount, utr, orderNo } = req.body;
        const finalOrderNo = orderNo || ('SBW' + Math.floor(100000 + Math.random() * 900000));
        
        const deposit = new Deposit({ userId, amount, utr, orderNo: finalOrderNo });
        await deposit.save();
        res.json({ success: true, message: "Deposit request submitted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Withdrawal API[span_7](start_span)[span_7](end_span)
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount, password, accountHolderName, upiId, bankName, accountNumber, ifsc, mobile, type } = req.body;
        const user = await User.findById(userId);
        
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        
        if (!password || user.password !== password) {
            return res.status(400).json({ success: false, message: "Incorrect password! Withdrawal cancelled." });
        }

        const numAmount = Number(amount);

        if (numAmount < 110 || numAmount > 1000000) {
            return res.status(400).json({ success: false, message: "Withdrawal amount must be between ₹110 and ₹1,000,000!" });
        }

        if ((user.totalBetDone || 0) < 110) {
            return res.status(400).json({ success: false, message: "You need to place bets totaling at least ₹110 before withdrawing!" });
        }

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const todayWithdrawalsCount = await Withdrawal.countDocuments({
            userId: userId,
            createdAt: { $gte: startOfToday },
            status: { $ne: 'rejected' }
        });

        if (todayWithdrawalsCount >= 3) {
            return res.status(400).json({ success: false, message: "Daily withdrawal limit of 3 times reached!" });
        }

        if (user.winningsBalance < numAmount) return res.status(400).json({ success: false, message: "Insufficient winnings balance!" });

        user.winningsBalance -= numAmount;
        await user.save();

        const finalOrderNo = 'SBW_W' + Math.floor(100000 + Math.random() * 900000);
        const withdrawal = new Withdrawal({ 
            userId, 
            amount: numAmount, 
            accountHolderName, 
            upiId, 
            bankName, 
            accountNumber, 
            ifsc, 
            mobile, 
            type: type || (upiId ? 'UPI' : 'BANK CARD'),
            orderNo: finalOrderNo 
        });
        await withdrawal.save();

        res.json({ success: true, message: "Withdrawal request submitted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/requests', async (req, res) => {
    try {
        const deposits = await Deposit.find().populate('userId', 'uid phone').sort({ createdAt: -1 });
        const withdrawals = await Withdrawal.find().populate('userId', 'uid phone').sort({ createdAt: -1 });
        res.json({ success: true, deposits, withdrawals });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ORDER NUMBER BASED ADMIN ACTION HANDLER (Deposit & Withdrawal)
app.post('/api/admin/action', async (req, res) => {
    try {
        const { type, id, orderNo, action, reason } = req.body;
        const act = String(action).toLowerCase().trim();

        if (type === 'deposit') {
            let query = orderNo ? { orderNo } : { _id: id };
            const dep = await Deposit.findOne(query);
            if (!dep) return res.status(404).json({ success: false, message: "Deposit not found" });

            if ((act === 'approve' || act === 'approved' || act === 'complete' || act === 'completed' || act === 'success') && dep.status === 'pending') {
                dep.status = 'approved';
                await dep.save();
                
                const user = await User.findById(dep.userId);
                if (user) {
                    user.balance = (user.balance || 0) + Number(dep.amount);
                    await user.save();
                }
                io.emit('refreshBalance');
            } else if (act === 'reject' || act === 'rejected' || act === 'fail' || act === 'failed') {
                if (dep.status !== 'rejected') {
                    dep.status = 'rejected';
                    if (reason) dep.rejectReason = reason;
                    await dep.save();
                    io.emit('refreshBalance');
                }
            } else {
                dep.status = action;
                await dep.save();
            }
        } else if (type === 'withdrawal') {
            let query = orderNo ? { orderNo } : { _id: id };
            const wit = await Withdrawal.findOne(query);
            if (!wit) return res.status(404).json({ success: false, message: "Withdrawal order not found" });
            
            if (act === 'approve' || act === 'approved' || act === 'complete' || act === 'completed' || act === 'success') {
                wit.status = 'approved';
                await wit.save();
                io.emit('refreshBalance');
            } else if (act === 'reject' || act === 'rejected' || act === 'fail' || act === 'failed') {
                if (wit.status !== 'rejected') {
                    wit.status = 'rejected';
                    await wit.save();
                    
                    const user = await User.findById(wit.userId);
                    if (user) {
                        user.winningsBalance = (user.winningsBalance || 0) + Number(wit.amount);
                        await user.save();
                    }
                    io.emit('refreshBalance');
                }
            } else {
                wit.status = action;
                await wit.save();
            }
        }
        res.json({ success: true, message: "Action executed successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/set-result', async (req, res) => {
    try {
        const { period, number } = req.body;
        await ManualOverride.findOneAndUpdate(
            { period },
            { number: Number(number), used: false },
            { upsert: true, new: true }
        );
        res.json({ success: true, message: `Manual override set for period ${period}` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/bets-summary/:period', async (req, res) => {
    try {
        const { period } = req.params;
        const bets = await Bet.find({ period });
        let totalAmount = 0;
        let breakdown = { big: 0, small: 0, green: 0, red: 0, violet: 0 };

        bets.forEach(b => {
            totalAmount += b.amount;
            if (b.betType === 'size' || b.betType === 'color') {
                breakdown[b.betValue] = (breakdown[b.betValue] || 0) + b.amount;
            } else if (b.betType === 'number') {
                let key = 'num_' + b.betValue;
                breakdown[key] = (breakdown[key] || 0) + b.amount;
            }
        });

        res.json({ success: true, totalAmount, breakdown });
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
        const bet = await Bet.findOne({ userId, period, timerType });
        if (!bet) return res.json({ success: true, hasBet: false });

        const gameRes = await GameResult.findOne({ period });
        res.json({ 
            success: true, 
            hasBet: true, 
            betData: {
                status: bet.status,
                amount: bet.amount,
                payout: bet.payout,
                betValue: bet.betValue,
                number: gameRes ? gameRes.number : '?',
                color: gameRes ? gameRes.color : '?',
                size: gameRes ? gameRes.size : '?'
            } 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Place Bet API[span_8](start_span)[span_8](end_span)
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

async function getGameOutcome(period, timerType) {
    const override = await ManualOverride.findOne({ period, used: false });
    let randomNum;

    if (override) {
        randomNum = override.number;
        override.used = true;
        await override.save();
    } else {
        const seed = period + "_" + timerType + "_yarwin_sync";
        const hash = crypto.createHash('sha256').update(seed).digest('hex');
        randomNum = parseInt(hash.substring(0, 8), 16) % 10;
    }

    let color = 'green';
    if ([2, 4, 6, 8].includes(randomNum)) color = 'red';
    else if ([0, 5].includes(randomNum)) color = 'violet';
    const size = randomNum >= 5 ? 'big' : 'small';

    return { number: randomNum, color, size };
}

async function processBetsForPeriod(period, timerType, outcome) {
    try {
        const pendingBets = await Bet.find({ period, timerType, status: 'pending' });

        for (const bet of pendingBets) {
            let isWin = false;
            let multiplier = 0;

            if (bet.betType === 'size' && bet.betValue === outcome.size) {
                isWin = true;
                multiplier = 1.96;
            } else if (bet.betType === 'color' && bet.betValue === outcome.color) {
                isWin = true;
                multiplier = (outcome.color === 'violet' ? 3.98 : 1.43);
            } else if (bet.betType === 'number' && Number(bet.betValue) === outcome.number) {
                isWin = true;
                multiplier = 8.96;
            }

            if (isWin) {
                const winnings = bet.amount * multiplier;
                bet.status = 'win';
                bet.payout = winnings;
                await bet.save();
                await User.findByIdAndUpdate(bet.userId, { $inc: { winningsBalance: winnings } });
            } else {
                bet.status = 'loss';
                await bet.save();
            }
        }
    } catch (err) {
        console.error(`Error processing bets:`, err);
    }
}

function startTimerLoop(timerType, intervalSeconds) {
    const state = gameStates[timerType];
    const intervalMs = intervalSeconds * 1000;
    
    const initTimer = () => {
        const now = Date.now();
        const startOfDay = new Date(new Date(now).setHours(0,0,0,0)).getTime();
        const elapsedMs = now - startOfDay;
        const currentIntervalIndex = Math.floor(elapsedMs / intervalMs);
        
        state.startTime = startOfDay + (currentIntervalIndex * intervalMs);
        const elapsedIntoInterval = now - state.startTime;
        state.countdown = intervalSeconds - Math.floor(elapsedIntoInterval / 1000) - 1;
        if (state.countdown < 0) state.countdown = 0;

        state.period = getPeriodCodeForTime(timerType, state.startTime);
        state.isBettingOpen = state.countdown > 5;
    };

    initTimer();

    setInterval(async () => {
        try {
            const now = Date.now();
            const elapsedIntoInterval = now - state.startTime;
            let countdown = intervalSeconds - Math.floor(elapsedIntoInterval / 1000) - 1;

            if (countdown < 0) {
                countdown = 0;
            }

            if (now >= state.startTime + intervalMs) {
                const oldPeriod = state.period;

                const outcome = await getGameOutcome(oldPeriod, timerType);

                const existingResult = await GameResult.findOne({ period: oldPeriod });
                if (!existingResult) {
                    const gameResult = new GameResult({
                        timerType, period: oldPeriod, number: outcome.number, color: outcome.color, size: outcome.size
                    });
                    await gameResult.save();
                }

                await processBetsForPeriod(oldPeriod, timerType, outcome);

                io.emit(`gameResult_${timerType}`, {
                    period: oldPeriod, number: outcome.number, color: outcome.color, size: outcome.size
                });

                state.startTime += intervalMs;
                state.period = getPeriodCodeForTime(timerType, state.startTime);
                state.isBettingOpen = true;
                io.emit(`bettingStatus_${timerType}`, { isOpen: true, period: state.period });

                const newElapsedIntoInterval = now - state.startTime;
                countdown = intervalSeconds - Math.floor(newElapsedIntoInterval / 1000) - 1;
            }

            if (countdown <= 5 && state.isBettingOpen) {
                state.isBettingOpen = false;
                io.emit(`bettingStatus_${timerType}`, { isOpen: false, period: state.period });
            }

            state.countdown = countdown;

            io.emit(`timerTick_${timerType}`, { 
                countdown: state.countdown, isBettingOpen: state.isBettingOpen, period: state.period 
            });
        } catch (err) {
            console.log(`Loop error:`, err.message);
        }
    }, 1000);
}

app.get('*', (req, res) => {
  if (req.path.startsWith('/assist/')) {
    res.sendFile(path.join(__dirname, req.path));
  } else {
    res.sendFile(path.join(__dirname, req.path.substring(1) || 'index.html'));
  }
});

mongoose.connect(MONGO_URI).then(async () => {
    console.log("Connected to MongoDB successfully!");
    await setupAdminAccount();
    startMidnightResetChecker();

    ['30s', '60s', '3m', '5m'].forEach(type => {
        let interval = type === '30s' ? 30 : (type === '60s' ? 60 : (type === '3m' ? 180 : 300));
        startTimerLoop(type, interval);
    });

}).catch(err => {
    console.error("MongoDB connection error:", err);
});

io.on('connection', (socket) => {
    let currentConnectedUserId = null;

    socket.on('registerUserSession', (userId) => {
        currentConnectedUserId = userId;
        if (userId) {
            activeOnlineSocketUsers.add(userId);
        }
    });

    socket.on('disconnect', () => {
        if (currentConnectedUserId) {
            setTimeout(() => {
                activeOnlineSocketUsers.delete(currentConnectedUserId);
            }, 10000);
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
