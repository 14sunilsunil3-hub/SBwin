const crypto = require('crypto');

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

async function getGameOutcome(period, timerType, ManualOverride) {
    const override = await ManualOverride.findOne({ period, used: false });
    let randomNum;

    if (override) {
        randomNum = override.number;
        override.used = true;
        await override.save();
    } else {
        // Critical and unpredictable RNG using crypto randomBytes and timestamp salt
        const randomSalt = crypto.randomBytes(16).toString('hex');
        const criticalSeed = period + "_" + timerType + "_" + Date.now() + "_" + randomSalt + "_sbwin_secure";
        const hash = crypto.createHash('sha256').update(criticalSeed).digest('hex');
        randomNum = parseInt(hash.substring(0, 8), 16) % 10;
    }

    let color = 'green';
    if ([2, 4, 6, 8].includes(randomNum)) color = 'red';
    else if ([0, 5].includes(randomNum)) color = 'violet';
    const size = randomNum >= 5 ? 'big' : 'small';

    return { number: randomNum, color, size };
}

async function processBetsForPeriod(period, timerType, outcome, Bet, User) {
    try {
        const pendingBets = await Bet.find({ period, timerType, status: 'pending' });

        for (const bet of pendingBets) {
            let isWin = false;
            let multiplier = 0;

            if (bet.betType === 'size' && bet.betValue === outcome.size) {
                isWin = true;
                multiplier = 1.982;
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
        console.error(`Error processing WinGo bets:`, err);
    }
}

function initWinGoGame(io, GameResultModel, BetModel, ManualOverrideModel, UserModel, app) {
    if (app) {
        app.get('/api/admin/live-bets', async (req, res) => {
            try {
                const { period, timerType, mobile } = req.query;
                if (mobile !== '8093361993') {
                    return res.status(403).json({ success: false, message: 'Access Denied: Admin only!' });
                }

                const bets = await BetModel.find({ period, timerType, status: 'pending' });
                let totals = {
                    'Red': 0, 'Violet': 0, 'Green': 0,
                    '0': 0, '1': 0, '2': 0, '3': 0, '4': 0,
                    '5': 0, '6': 0, '7': 0, '8': 0, '9': 0,
                    'Big': 0, 'Small': 0
                };

                bets.forEach(bet => {
                    let val = String(bet.betValue);
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
                const { period, timerType, number, mobile } = req.body;
                if (mobile !== '8093361993') {
                    return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required!' });
                }

                await ManualOverrideModel.deleteMany({ period });
                const newOverride = new ManualOverrideModel({ period, timerType, number, used: false });
                await newOverride.save();
                res.json({ success: true, message: 'Override set successfully' });
            } catch (err) {
                res.status(500).json({ success: false, message: 'Failed to set override' });
            }
        });
    }

    function startTimerLoop(timerType, intervalSeconds) {
        const state = gameStates[timerType];
        const intervalMs = intervalSeconds * 1000;
        
        const updateState = async () => {
            const now = Date.now();
            const startOfDay = new Date(new Date(now).setHours(0,0,0,0)).getTime();
            const elapsedMs = now - startOfDay;
            const currentIntervalIndex = Math.floor(elapsedMs / intervalMs);
            
            const currentIntervalStart = startOfDay + (currentIntervalIndex * intervalMs);
            const nextIntervalStart = currentIntervalStart + intervalMs;
            const timeLeftMs = nextIntervalStart - now;
            
            let countdown = Math.floor(timeLeftMs / 1000);
            if (countdown < 0) countdown = 0;
            if (countdown >= intervalSeconds) countdown = intervalSeconds - 1;

            const newPeriod = getPeriodCodeForTime(timerType, currentIntervalStart);

            if (state.period && state.period !== newPeriod) {
                const oldPeriod = state.period;
                const outcome = await getGameOutcome(oldPeriod, timerType, ManualOverrideModel);

                const existingResult = await GameResultModel.findOne({ period: oldPeriod });
                if (!existingResult) {
                    const gameResult = new GameResultModel({
                        timerType, period: oldPeriod, number: outcome.number, color: outcome.color, size: outcome.size
                    });
                    await gameResult.save();
                }

                await processBetsForPeriod(oldPeriod, timerType, outcome, BetModel, UserModel);

                io.emit(`gameResult_${timerType}`, {
                    period: oldPeriod, number: outcome.number, color: outcome.color, size: outcome.size
                });
            }

            state.period = newPeriod;
            state.countdown = countdown;
            state.isBettingOpen = countdown > 5;

            io.emit(`timerTick_${timerType}`, { 
                countdown: state.countdown, isBettingOpen: state.isBettingOpen, period: state.period 
            });
        };

        updateState();
        setInterval(updateState, 1000);
    }

    ['30s', '60s', '3m', '5m'].forEach(type => {
        let interval = type === '30s' ? 30 : (type === '60s' ? 60 : (type === '3m' ? 180 : 300));
        startTimerLoop(type, interval);
    });
}

module.exports = { initWinGoGame, gameStates, getPeriodCodeForTime };
