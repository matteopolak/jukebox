export interface GeniusResponse<T> {
	meta: {
		status: number;
	};
	response: T;
}

export interface Song {
	type: string;
	result: {
		id: number;
		lyrics_state: string;
		instrumental: boolean;
	};
}

export interface SearchResponse {
	sections: [
		{
			type: 'top_hit';
			hits: Song[];
		},
		{
			type: 'song';
			hits: Song[];
		},
		{
			type: 'lyric';
			hits: Song[];
		}
	];
}
