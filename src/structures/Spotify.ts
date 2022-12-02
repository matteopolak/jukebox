import { Option, SongData, SongProvider } from '@/typings/common';
import { bufferUnordered } from '@/util/promise';

import axios from 'axios';

const MAX_BATCH_SIZE = 100;

interface Token {
	token: string;
	expires: number;
}

interface TokenRefreshResponse {
	clientId: string;
	accessToken: string;
	accessTokenExpirationTimestampMs: number;
}

interface Container<T> {
	items: T[];
	total: number;
}

interface Artist {
	name: string;
}

interface Track {
	id: string;
	name: string;
	duration_ms: number;
	artists: Artist[];
	album: {
		images: {
			url: string;
		}[];
	}
}

interface PaginatedTrack {
	track: Track;
}

interface PlaylistMetadata {
	name: string;
	tracks: Container<Track>;
}

interface AlbumMetadata {
	name: string;
	tracks: Container<Track>;
}

interface Playlist {
	name: string;
	tracks: Track[];
}

export class Spotify {
	private _accessToken: Option<Token>;
	private _accessTokenPromise: Option<Promise<string>>;

	private async _getAccessToken() {
		const response = await axios.get<TokenRefreshResponse>('https://open.spotify.com/get_access_token');

		this._accessTokenPromise = undefined;
		this._accessToken = {
			token: response.data.accessToken,
			expires: response.data.accessTokenExpirationTimestampMs,
		};

		return this._accessToken.token;
	}

	/**
	 * 
	 * @param n The number of milliseconds that the token must be valid for in order to be considered valid
	 */
	private async getAccessToken(n = 10_000) {
		// if the token is being refreshed, return the promise
		if (this._accessTokenPromise) return this._accessTokenPromise;

		// if the token is still valid for the next `n` milliseconds, return it
		if (this._accessToken && this._accessToken.expires > Date.now() + n) return this._accessToken.token;

		this._accessTokenPromise = this._getAccessToken();
		const response = await this._accessTokenPromise;

		this._accessTokenPromise = undefined;

		return response;
	}

	public static trackToSongData(track: Track): SongData {
		return {
			title: track.name,
			artist: track.artists.map(artist => artist.name).join(', '),
			duration: track.duration_ms,
			url: '',
			live: false,
			id: track.id,
			type: SongProvider.Spotify,
			thumbnail: track.album.images[0]?.url ?? '',
		};
	}

	public async getTrack(id: string): Promise<Option<Track>> {
		const response = await axios.get<Track>(`https://api.spotify.com/v1/tracks/${id}`, {
			headers: {
				Authorization: `Bearer ${await this.getAccessToken()}`,
			},
			params: {
				market: 'AX',
			},
		});

		if (response.status !== 200) return undefined;

		return response.data;
	}

	public async getAlbum(id: string): Promise<Option<Playlist>> {
		const response = await axios.get<AlbumMetadata>(`https://api.spotify.com/v1/albums/${id}`, {
			headers: {
				Authorization: `Bearer ${await this.getAccessToken()}`,
			},
			params: {
				limit: MAX_BATCH_SIZE,
				// use an obscure market to stay anonymous
				market: 'AX',
			},
		});

		if (response.status !== 200) return undefined;

		const total = response.data.tracks.total;
		const batches = Math.ceil(total / MAX_BATCH_SIZE) - 1;

		const tracks = await bufferUnordered(Array(batches), async (_, index) => {
			const response = await axios.get<Container<Track>>(`https://api.spotify.com/v1/albums/${id}/tracks`, {
				headers: {
					Authorization: `Bearer ${await this.getAccessToken()}`,
				},
				params: {
					offset: index * MAX_BATCH_SIZE + MAX_BATCH_SIZE,
					limit: MAX_BATCH_SIZE,
					market: 'AX',
				},
			});

			return response.data.items;
		});

		tracks.push(response.data.tracks.items);

		return {
			name: response.data.name,
			tracks: tracks.flat(),
		};
	}

	public async getPlaylist(id: string): Promise<Option<Playlist>> {
		const response = await axios.get<PlaylistMetadata>(`https://api.spotify.com/v1/playlists/${id}`, {
			headers: {
				Authorization: `Bearer ${await this.getAccessToken()}`,
			},
			params: {
				limit: MAX_BATCH_SIZE,
				additional_types: 'track',
				fields: 'name,owner(display_name),public,tracks(total,offset,limit,items(track(album(images),name,duration_ms,id,artists(name))))',
			},
		});

		if (response.status !== 200) return undefined;

		const total = response.data.tracks.total;
		const batches = Math.ceil(total / MAX_BATCH_SIZE) - 1;

		const tracks = await bufferUnordered(Array(batches), async (_, index) => {
			const response = await axios.get<Container<PaginatedTrack>>(`https://api.spotify.com/v1/playlists/${id}/tracks`, {
				headers: {
					Authorization: `Bearer ${await this.getAccessToken()}`,
				},
				params: {
					offset: index * MAX_BATCH_SIZE + MAX_BATCH_SIZE,
					limit: MAX_BATCH_SIZE,
					additional_types: 'track',
					fields: 'items(track(album(images),id,name,duration_ms,artists(name)))',
				},
			});

			return response.data.items.map(item => item.track);
		});

		tracks.push(response.data.tracks.items);

		return {
			name: response.data.name,
			tracks: tracks.flat(),
		};
	}
}