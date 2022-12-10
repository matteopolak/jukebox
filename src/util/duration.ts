const INDEX_TO_DURATION: Record<number, number> = {
	0: 1_000,
	1: 60_000,
	2: 3_600_000,
	3: 86_400_000,
};

export function parseDurationString(duration: string): number {
	return duration
		.split(':')
		.reduceRight((a, b, i) => a + INDEX_TO_DURATION[i] * parseInt(b), 0);
}

export function formatSeconds(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const secondsLeft = Math.round(seconds % 60);

	return `${minutes}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;
}

export function formatMilliseconds(ms: number) {
	return formatSeconds(ms / 1000);
}
