function getISOWeekString(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

function getDateOfISOWeek(weekStr) {
    if (!weekStr) return null;
    const parts = weekStr.split('-W');
    if (parts.length !== 2) return null;
    const year = parseInt(parts[0], 10);
    const week = parseInt(parts[1], 10);
    if (isNaN(year) || isNaN(week)) return null;
    
    // ISO week date algorithm: January 4th is always in week 1.
    const d = new Date(Date.UTC(year, 0, 4));
    const day = d.getUTCDay() || 7; // Monday = 1, Sunday = 7
    // Set to Monday of week 1
    d.setUTCDate(d.getUTCDate() - day + 1);
    // Add (week - 1) weeks
    d.setUTCDate(d.getUTCDate() + (week - 1) * 7);
    return d;
}

function isWeekWithinExcuse(startWeekId, durationWeeks, targetWeekId) {
    const startMonday = getDateOfISOWeek(startWeekId);
    const targetMonday = getDateOfISOWeek(targetWeekId);
    if (!startMonday || !targetMonday) return { excused: false, weeksRemaining: 0 };
    
    const endMonday = new Date(startMonday.getTime() + durationWeeks * 7 * 86400000);
    if (targetMonday >= startMonday && targetMonday < endMonday) {
        const weeksRemaining = Math.max(0, Math.ceil((endMonday - targetMonday) / (7 * 86400000)));
        return { excused: true, weeksRemaining };
    }
    return { excused: false, weeksRemaining: 0 };
}

module.exports = {
    getISOWeekString,
    getDateOfISOWeek,
    isWeekWithinExcuse
};
