export async function fetchWordList(path: string): Promise<string[]> {
    const res = await fetch(path);
    if (!res.ok) {
        throw new Error(`Failed to load ${path}`);
    }

    const text = await res.text();

    return text
        .split(/\r?\n/)
        .map(w => w.trim())
        .filter(Boolean);
}

export async function loadAllWordLists() {
    const [short, medium, long, mixed] = await Promise.all([
        fetchWordList("/short.txt"),
        fetchWordList("/medium.txt"),
        fetchWordList("/long.txt"),
        fetchWordList("/mixed.txt"),
    ]);

    return { short, medium, long, mixed}
}