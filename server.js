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

// Serve static files from root directory (ensures assist/ and assets/ load correctly)
app.use(express.static(path.join(__dirname)));

const MONGO_URI = "mongodb+srv://bbutu218_db_user:9RnyfbrEBzNaZlYX@cluster0.gq1rmfz.mongodb.net/?appName=Cluster0";

function generateUID() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const userSchema = new mongoose.Schema({
    uid: { type: String, unique: true, default: generateUID },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 5 }, 
    winningsBalance: { type: Number, default: 0 }, 
    rewardCoins: { type: Number, default: 0 }, 
    referredBy: { type: String, default: null },
    lastDailyClaim: { type: Date, default: null },
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
    transactionId: String,
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
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

const qrCodeSchema = new mongoose.Schema({
    identifier: { type: String, unique: true, default: 'default_qr' },
    imageBase64: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
});
const QrCode = mongoose.model('QrCode', qrCodeSchema);

const ADMIN_NUMBERS = ["8093361993", "+918093361993", "918093361993"];

async function setupAdminAccount() {
    try {
        const adminPhone = "8093361993";
        const adminPassword = "123123";

        let adminUser = await User.findOne({ phone: adminPhone });
        if (!adminUser) {
            adminUser = new User({
                phone: adminPhone,
                password: adminPassword,
                balance: 1000000,
                winningsBalance: 500000,
                rewardCoins: 50050
            });
            await adminUser.save();
        } else {
            adminUser.password = adminPassword;
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

app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, refUid } = req.body;
        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists!" });

        let referrer = null;
        if (refUid) {
            referrer = await User.findOne({ uid: refUid });
        }

        const newUser = new User({ 
            phone, 
            password, 
            balance: 0, 
            winningsBalance: 0,
            rewardCoins: 100,
            referredBy: refUid || null 
        });

        await newUser.save();

        if (referrer) {
            referrer.rewardCoins += 500;
            await referrer.save();
        }

        res.json({ success: true, message: "Registration successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone, password });
        if (!user) return res.status(400).json({ success: false, message: "Invalid phone or password!" });

        const isAdmin = ADMIN_NUMBERS.includes(phone);

        res.json({ 
            success: true, 
            message: "Login successful!", 
            userId: user._id, 
            balance: user.balance,
            winningsBalance: user.winningsBalance,
            rewardCoins: user.rewardCoins,
            isAdmin: isAdmin,
            user: { 
                _id: user._id, 
                uid: user.uid,
                phone: user.phone, 
                balance: user.balance, 
                winningsBalance: user.winningsBalance,
                rewardCoins: user.rewardCoins,
                isAdmin: isAdmin
            } 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/claim-daily', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found!" });

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (user.lastDailyClaim && new Date(user.lastDailyClaim) >= startOfToday) {
            return res.status(400).json({ success: false, message: "You have already claimed your daily bonus today!" });
        }

        const earnedReward = parseFloat((Math.random() * (30 - 0.10) + 0.10).toFixed(2));
        user.rewardCoins += earnedReward;
        user.lastDailyClaim = now;
        await user.save();

        res.json({ success: true, reward: earnedReward, message: `Successfully claimed ${earnedReward} coins!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        const isAdmin = ADMIN_NUMBERS.includes(user.phone);
        res.json({ success: true, balance: user.balance, winningsBalance: user.winningsBalance, rewardCoins: user.rewardCoins, isAdmin, user });
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

app.post('/api/deposit', async (req, res) => {
    try {
        const { userId, amount, transactionId } = req.body;
        const deposit = new Deposit({ userId, amount, transactionId });
        await deposit.save();
        res.json({ success: true, message: "Deposit request submitted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount, password, accountHolderName, upiId, bankName, accountNumber, ifsc, mobile } = req.body;
        const user = await User.findById(userId);
        
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (user.password !== password) return res.status(400).json({ success: false, message: "Incorrect password!" });
        if (Number(amount) < 110) return res.status(400).json({ success: false, message: "Minimum withdrawal amount is ₹110!" });
        if (user.winningsBalance < Number(amount)) return res.status(400).json({ success: false, message: "Insufficient winnings balance!" });

        user.winningsBalance -= Number(amount);
        await user.save();

        const withdrawal = new Withdrawal({ userId, amount, accountHolderName, upiId, bankName, accountNumber, ifsc, mobile });
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

app.post('/api/admin/action', async (req, res) => {
    try {
        const { type, id, action } = req.body;
        if (type === 'deposit') {
            const dep = await Deposit.findById(id);
            if (!dep) return res.status(404).json({ success: false, message: "Deposit not found" });
            if (action === 'approve' && dep.status === 'pending') {
                dep.status = 'approved';
                await dep.save();
                await User.findByIdAndUpdate(dep.userId, { $inc: { balance: dep.amount } });
            } else {
                dep.status = action;
                await dep.save();
            }
        } else if (type === 'withdrawal') {
            const wit = await Withdrawal.findById(id);
            if (!wit) return res.status(404).json({ success: false, message: "Withdrawal not found" });
            if (action === 'reject' && wit.status === 'pending') {
                wit.status = 'rejected';
                await wit.save();
                await User.findByIdAndUpdate(wit.userId, { $inc: { winningsBalance: wit.amount } });
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
        await user.save();

        const newBet = new Bet({ userId, timerType, period, betType, betValue, amount });
        await newBet.save();

        res.json({ success: true, message: "Bet successfully added!", newBalance: user.balance, newWinnings: user.winningsBalance, rewardCoins: user.rewardCoins });
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
                multiplier = 1.9;
            } else if (bet.betType === 'color' && bet.betValue === outcome.color) {
                isWin = true;
                multiplier = (outcome.color === 'violet' ? 2 : 1.9);
            } else if (bet.betType === 'number' && Number(bet.betValue) === outcome.number) {
                isWin = true;
                multiplier = 9;
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
        state.countdown = intervalSeconds - 1 - Math.floor(elapsedIntoInterval / 1000);
        if (state.countdown < 0) state.countdown = 0;

        state.period = getPeriodCodeForTime(timerType, state.startTime);
        state.isBettingOpen = state.countdown > 5;
    };

    initTimer();

    setInterval(async () => {
        try {
            const now = Date.now();
            const elapsedIntoInterval = now - state.startTime;
            let countdown = intervalSeconds - 1 - Math.floor(elapsedIntoInterval / 1000);

            if (countdown < 0) {
                countdown = 0;
            }

            // Check if interval has completely finished (reached next period boundary)
            if (now >= state.startTime + intervalMs) {
                const oldPeriod = state.period;

                // Process result for the completed period
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

                // Shift to new period
                state.startTime += intervalMs;
                state.period = getPeriodCodeForTime(timerType, state.startTime);
                state.isBettingOpen = true;
                io.emit(`bettingStatus_${timerType}`, { isOpen: true, period: state.period });

                const newElapsedIntoInterval = now - state.startTime;
                countdown = intervalSeconds - 1 - Math.floor(newElapsedIntoInterval / 1000);
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

// Catch-all route to correctly serve assist folder files or index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/assist/')) {
    res.sendFile(path.join(__dirname, req.path));
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

mongoose.connect(MONGO_URI).then(async () => {
    console.log("Connected to MongoDB successfully!");
    await setupAdminAccount();

    ['30s', '60s', '3m', '5m'].forEach(type => {
        let interval = type === '30s' ? 30 : (type === '60s' ? 60 : (type === '3m' ? 180 : 300));
        startTimerLoop(type, interval);
    });

}).catch(err => {
    console.error("MongoDB connection error:", err);
});

io.on('connection', (socket) => {
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
