import axios, { AxiosInstance } from 'axios';

import { Provider } from '@/structures/provider';
import { ProviderOrigin, Result, SearchResult, SongData } from '@/typings/common';
import { bufferUnordered } from '@/util/promise';

const MAX_BATCH_SIZE_TRACK = 300;

export interface Track {
	id: string;
	attributes: {
		trackNumber: number;
		durationInMillis: number;
		artwork: {
			url: string;
		};
		name: string;
		artistName: string;
	};
}

export interface Album {
	id: string;
	attributes: {
		artwork: {
			url: string;
		};
		name: string;
		artistName: string;
		trackCount: number;
	};
	relationships: {
		tracks: Paginated<Track>;
	};
}

export interface Playlist {
	id: string;
	attributes: {
		artwork: {
			url: string;
		};
		name: string;
		trackCount: number;
	};
	relationships: {
		tracks: Paginated<Track>;
	};
}

export interface Paginated<T> {
	data: T[];
	next?: string;
}

export interface Response<T> {
	data: [T];
}

export class AppleProvider extends Provider {
	private http: AxiosInstance;

	constructor() {
		super();

		this.http = axios.create({
			baseURL: 'https://amp-api.music.apple.com/v1',
			headers: {
				origin: 'https://music.apple.com',
				// use the default bearer token from the web player
				authorization: 'Bearer eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IldlYlBsYXlLaWQifQ.eyJpc3MiOiJBTVBXZWJQbGF5IiwiaWF0IjoxNjY4ODAwNDE0LCJleHAiOjE2NzYwNTgwMTQsInJvb3RfaHR0cHNfb3JpZ2luIjpbImFwcGxlLmNvbSJdfQ.lU7UBXnRH7LGMnCu2q9x99yBTE0OAHRtzA1h31eyrzlOl8W-1JDxnk74GnRoXxmnRpyYebGCNtt3bphRHQ-mEg',
			},
		});
	}

	public static trackToSongData(track: Track): SongData {
		return {
			id: track.id,
			uid: track.id,
			title: track.attributes.name,
			artist: track.attributes.artistName,
			duration: track.attributes.durationInMillis,
			thumbnail: track.attributes.artwork.url.replace('{w}', '500').replace('{h}', '500'),
			url: '',
			live: false,
			type: ProviderOrigin.Apple,
		};
	}

	private async _getTracks(type: string, id: string, catalog: string, batches: number, start = 0) {
		const tracks: Track[] = [];

		await bufferUnordered(Array.from({ length: batches }, () => undefined), async (_, index) => {
			const response = await this.http.get<Paginated<Track>>(`/catalog/${catalog}/${type}/${id}/tracks`, {
				params: {
					limit: MAX_BATCH_SIZE_TRACK,
					offset: start + index * MAX_BATCH_SIZE_TRACK,
				},
			});

			tracks.push(...response.data.data);
		});

		return tracks;
	}

	private async _getTracksPaginated(next?: string) {
		const tracks: Track[] = [];

		while (next) {
			const response = await this.http.get<Paginated<Track>>(next, {
				baseURL: 'https://amp-api.music.apple.com',
			});
			tracks.push(...response.data.data);

			next = response.data.next;
		}

		return tracks;
	}

	public async getAlbum(id: string, catalog = 'us'): Promise<Result<SearchResult>> {
		const response = await this.http.get<Response<Album>>(`/catalog/${catalog}/albums/${id}`);
		if (response.status !== 200) return { ok: false, error: `An album with the id \`${id}\` does not exist.` };

		const album = response.data.data[0];
		if (!album) return { ok: false, error: `An album with the id \`${id}\` does not exist.` };

		const tracks = await this._getTracks(
			'albums',
			id,
			catalog,
			Math.ceil(album.attributes.trackCount / MAX_BATCH_SIZE_TRACK) - 1,
			MAX_BATCH_SIZE_TRACK
		);

		tracks.unshift(...album.relationships.tracks.data);

		return {
			ok: true,
			value: {
				title: album.attributes.name,
				videos: tracks.map(AppleProvider.trackToSongData),
			},
		};
	}

	public async getPlaylist(id: string, catalog = 'us'): Promise<Result<SearchResult>> {
		const response = await this.http.get<Response<Playlist>>(`/catalog/${catalog}/playlists/${id}`);
		if (response.status !== 200) return { ok: false, error: `A playlist with the id \`${id}\` does not exist.` };

		const playlist = response.data.data[0];
		if (!playlist) return { ok: false, error: `A playlist with the id \`${id}\` does not exist.` };

		const tracks = await this._getTracksPaginated(playlist.relationships.tracks.next);
		tracks.unshift(...playlist.relationships.tracks.data);

		return {
			ok: true,
			value: {
				title: playlist.attributes.name,
				videos: tracks.map(AppleProvider.trackToSongData),
			},
		};
	}
}
