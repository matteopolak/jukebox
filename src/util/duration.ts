export function parseDurationString(duration: string): number {
	const d = duration.split(':');
	const ms = parseInt(d[0]) * 60_000 + parseInt(d[1]) * 1_000;

	return ms;
}

export function formatSeconds(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const secondsLeft = seconds % 60;

	return `${minutes}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;
}

export function formatMilliseconds(ms: number) {
	return formatSeconds(ms / 1000);
}
