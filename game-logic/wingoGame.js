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

// Stores the upcoming result for `${timerType}:${period}` so team view sees the exact result that will come
const upcomingPeriodOutcomes = new Map();

function buildOutcomeFromNumber(randomNum) {
    const num = ((Number(randomNum) % 10) + 10) % 10;
    let color = 'green';
    if ([2, 4, 6, 8].includes(num)) color = 'red';
    else if ([0, 5].includes(num)) color = 'violet';
    const size = num >= 5 ? 'big' : 'small';
    return { number: num, color, size };
}

// 2nd Option: Cryptographic Random Integer (0 to 9)
function getRngOutcome(period, timerType) {
    const randomNum = crypto.randomInt(0, 10);
    return buildOutcomeFromNumber(randomNum);
}

function saveUpcomingOutcome(period, timerType, outcome) {
    if (!period) return outcome;
    const key = `${timerType || '30s'}:${String(period)}`;
    upcomingPeriodOutcomes.set(key, outcome);

    if (upcomingPeriodOutcomes.size > 600) {
        const firstKey = upcomingPeriodOutcomes.keys().next().value;
        upcomingPeriodOutcomes.delete(firstKey);
    }
    return outcome;
}

async function getUpcomingPeriodOutcome(period, timerType, ManualOverrideModel) {
    const safePeriod = String(period || '');
    const safeType = String(timerType || '30s');
    const key = `${safeType}:${safePeriod}`;

    if (ManualOverrideModel && safePeriod) {
        const override = await ManualOverrideModel.findOne({ period: safePeriod, used: false });
        if (override) {
            const overrideOutcome = buildOutcomeFromNumber(override.number);
            return saveUpcomingOutcome(safePeriod, safeType, { ...overrideOutcome, isOverride: true });
        }
    }

    if (upcomingPeriodOutcomes.has(key)) {
        const existing = upcomingPeriodOutcomes.get(key);
        if (!existing.isOverride) {
            return existing;
        }
    }

    const generated = getRngOutcome(safePeriod, safeType);
    return saveUpcomingOutcome(safePeriod, safeType, { ...generated, isOverride: false });
}

async function getGameOutcome(period, timerType, ManualOverride) {
    const safePeriod = String(period || '');
    const safeType = String(timerType || '30s');
    const key = `${safeType}:${safePeriod}`;

    const override = await ManualOverride.findOne({ period: safePeriod, used: false });

    if (override) {
        const overrideNum = override.number;
        override.used = true;
        await override.save();
        upcomingPeriodOutcomes.delete(key);
        return buildOutcomeFromNumber(overrideNum);
    }

    const upcoming = upcomingPeriodOutcomes.get(key);
    upcomingPeriodOutcomes.delete(key);
    if (upcoming) {
        return buildOutcomeFromNumber(upcoming.number);
    }

    return getRngOutcome(safePeriod, safeType);
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
                multiplier = 8.962;
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

function initWinGoGame(io, GameResultModel, BetModel, ManualOverrideModel, UserModel) {
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

            if (newPeriod) {
                await getUpcomingPeriodOutcome(newPeriod, timerType, ManualOverrideModel);
            }

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

module.exports = {
    initWinGoGame,
    gameStates,
    getPeriodCodeForTime,
    getRngOutcome,
    getUpcomingPeriodOutcome
};
