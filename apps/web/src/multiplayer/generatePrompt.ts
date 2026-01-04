import { randomMathTricks } from "./rng";

export function generatePrompt(
    words: string[],
    seed: number,
    wordCount: number
) {
    const rand = randomMathTricks(seed);
    const out : string[] = [];

    for (let i = 0; i < wordCount; i++) {
        const idx = Math.floor(rand() * words.length);
        out.push(words[idx]);
    }

    return out.join(" ");
}