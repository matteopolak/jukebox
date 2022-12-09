declare module 'soundcloud-downloader/dist/index.js' {
	import type { Readable } from 'node:stream';

	const enum STREAMING_PROTOCOLS {
		HLS = 'hls',
		PROGRESSIVE = 'progressive'
	}

	const enum FORMATS {
		MP3 = 'audio/mpeg',
		OPUS = 'audio/ogg; codecs="opus"'
	}

	export interface User {
		kind: string,
		avatar_url: string,
		city: string,
		comments_count: number,
		country_code: string,
		created_at: string,
		description: string,
		followers_count: number,
		followings_count: number,
		first_name: string,
		full_name: string,
		groups_count: number,
		id: number,
		last_name: string,
		permalink_url: string,
		uri: string,
		username: string
	}

	export interface TrackInfo {
		kind: string
		monetization_model: string,
		id: number,
		policy: string,
		comment_count?: number,
		full_duration?: number,
		downloadable?: false,
		created_at?: string,
		description?: string,
		media?: { transcodings: Transcoding[] },
		title?: string,
		publisher_metadata?: unknown,
		duration?: number,
		has_downloads_left?: boolean,
		artwork_url?: string,
		public?: boolean,
		streamable?: true,
		tag_list?: string,
		genre?: string,
		reposts_count?: number,
		label_name?: string,
		state?: string,
		last_modified?: string,
		commentable?: boolean,
		uri?: string,
		download_count?: number,
		likes_count?: number,
		display_date?: string,
		user_id?: number,
		waveform_url?: string,
		permalink?: string,
		permalink_url?: string,
		user?: User,
		playback_count?: number
	}

	export interface SetInfo {
		title: string,
		duration: number,
		permalink_url: string,
		reposts_count: number,
		genre: string,
		permalink: string,
		purchase_url?: string,
		description?: string,
		uri: string,
		label_name?: string,
		tag_list: string,
		set_type: string,
		public: boolean,
		track_count: number,
		user_id: number,
		last_modified: string,
		license: string,
		tracks: TrackInfo[],
		id: number,
		release_date?: string,
		display_date: string,
		sharing: string,
		secret_token?: string,
		created_at: string,
		likes_count: number,
		kind: string,
		purchase_title?: string,
		managed_by_feeds: boolean,
		artwork_url?: string,
		is_album: boolean,
		user: User,
		published_at: string,
		embeddable_by: string
	}

	export interface Transcoding {
		url: string,
		preset: string,
		snipped: boolean,
		format: { protocol: STREAMING_PROTOCOLS, mime_type: FORMATS }
	}

	export function getSetInfo(url: string): Promise<SetInfo>;
	export function getInfo(url: string): Promise<TrackInfo>;
	export function download(url: string, useDirectLink?: boolean): Promise<Readable>;
}
