const MS_PER_UNIT = {
    ms: 1,
    second: 1000,
    seconds: 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
};

/** Adds `value` of `unit` to `date`, returning a new Date. Months/years use calendar math; everything else is a fixed millisecond offset. */
function add(date, value, unit) {
    const result = new Date(date.getTime());
    const u = String(unit).toLowerCase();
    if (u === 'month' || u === 'months') {
        result.setMonth(result.getMonth() + value);
        return result;
    }
    if (u === 'year' || u === 'years') {
        result.setFullYear(result.getFullYear() + value);
        return result;
    }
    const ms = MS_PER_UNIT[u];
    if (ms === undefined) throw new Error(`Unknown duration unit "${unit}"`);
    return new Date(result.getTime() + value * ms);
}

export { add };
