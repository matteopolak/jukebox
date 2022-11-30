export function randomInteger(max: number, min = 0) {
	return Math.floor(Math.random() * (max - min));
}

export function randomElement<T>(array: T[]): T {
	return array[Math.floor(Math.random() * array.length)];
}
