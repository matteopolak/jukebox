// implementation of a circular buffer that can be used to store
// a fixed number of elements. when the buffer is full, adding a
// new element will overwrite the oldest one.
//
// the buffer is implemented as a fixed-size array, and two
// pointers are used to track the start and end of the buffer.
// note that the end pointer points to the *next* empty slot.
export class CircularBuffer<T> {
	private _buffer: T[];
	private _start: number;
	private _end: number;
	private _size: number;

	constructor(size: number) {
		this._buffer = new Array(size);
		this._start = 0;
		this._end = 0;
		this._size = size;
	}

	// push a new element to the buffer. if the buffer is full,
	// this will overwrite the oldest element.
	public push(elem: T) {
		this._buffer[this._end] = elem;
		this._end = (this._end + 1) % this._size;

		if (this._end === this._start) {
			this._start = (this._start + 1) % this._size;
		}
	}

	// return the buffer contents as an array
	public toArray() {
		const result: T[] = [];

		for (let i = this._start; i !== this._end; i = (i + 1) % this._size) {
			result.push(this._buffer[i]);
		}

		return result;
	}

	// return the buffer contents as a set
	public toSet() {
		return new Set(this.toArray());
	}
}
