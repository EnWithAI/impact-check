const MAX_EXAMPLE_PATHS = 20;
/** Collects coverage limitations deterministically (sorted codes and paths, capped examples). */
export class Limitations {
    entries = new Map();
    add(code, message, path) {
        let entry = this.entries.get(code);
        if (!entry) {
            entry = { message, paths: new Set(), count: 0 };
            this.entries.set(code, entry);
        }
        if (path === undefined) {
            entry.count = Math.max(entry.count, 1);
            return;
        }
        if (!entry.paths.has(path)) {
            entry.paths.add(path);
            entry.count++;
        }
    }
    /** Record a limitation with an explicit count (no paths). */
    addCount(code, message, count) {
        this.entries.set(code, { message, paths: new Set(), count });
    }
    has(code) {
        return this.entries.has(code);
    }
    merge(other) {
        for (const item of other.toArray(Number.MAX_SAFE_INTEGER)) {
            if (item.paths.length === 0)
                this.add(item.code, item.message);
            for (const path of item.paths)
                this.add(item.code, item.message, path);
        }
    }
    toArray(maxPaths = MAX_EXAMPLE_PATHS) {
        return [...this.entries.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([code, entry]) => ({
            code,
            message: entry.message,
            paths: [...entry.paths].sort(compareStrings).slice(0, maxPaths),
            count: entry.count,
        }));
    }
}
/** Locale-independent string comparison used for every sort, so output order is identical on all machines. */
export function compareStrings(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
