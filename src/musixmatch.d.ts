export interface Track {
	track_id: number;
	track_name: string;
	track_length: number;
	album_name: string;
	artist_name: string;
	album_coverart_100x100: string;
	album_coverart_350x350: string;
	album_coverart_500x500: string;
	album_coverart_800x800: string;
	has_lyrics: 0 | 1;
	has_richsync: 0 | 1;
}

interface MusixmatchResponseSuccess<T> {
	header: {
		status_code: 200;
		execute_time: number;
		available?: number;
	};
	body: T extends null ? never : T;
}

interface MusixmatchResponseFailure {
	header: {
		status_code: 404;
		execute_time: number;
	};
	body: null;
}

export interface MusixmatchResponse<T> {
	message: MusixmatchResponseSuccess<T> | MusixmatchResponseFailure;
}

export interface MacroSearchResponse {
	macro_result_list: {
		track_list: { track: Track }[];
		artist_list: unknown[];
	};
	best_match: {
		type: 'track';
		id: number;
	};
}

export interface TrackSearchResponse {
	track_list: { track: Track }[];
}

export interface TrackGetResponse {
	track: Track;
}

export interface TrackLyricsResponse {
	lyrics: {
		lyrics_id: number;
		lyrics_body: string;
		lyrics_language: string;
		lyrics_language_description: string;
		lyrics_copyright: string;
	};
}
