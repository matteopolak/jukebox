// TODO: reverse-engineer Spotify's GraphQL API

import axios, { AxiosInstance } from 'axios';

import { Provider } from '@/structures/provider';
import { Option, ProviderOrigin, Result, SearchResult, SongData } from '@/typings/common';
import { bufferUnordered } from '@/util/promise';
import { getCachedSong } from '@/util/search';

const MAX_BATCH_SIZE_PLAYLIST = 100;
const MAX_BATCH_SIZE_ALBUM = 50;
const MAX_BATCH_SIZE_CHART_CATEGORY = 50;

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
	tracks: Container<PaginatedTrack>;
}

interface AlbumMetadata {
	name: string;
	tracks: Container<Track>;
	images: {
		url: string;
	}[];
}

interface Chart {
	name: string;
	id: string;
}

interface Cached<T> {
	data: T;
	expires: number;
}

interface Content<T> {
	content: T;
	id: string;
}

export class SpotifyProvider extends Provider {
	private http: AxiosInstance;

	private _accessToken: Option<Token>;
	private _accessTokenPromise: Option<Promise<string>>;
	private _clientToken: Option<string>;
	private _clientTokenPromise: Option<Promise<string>>;
	private _charts: Cached<Chart[]> = { data: [], expires: 0 };
	private _chartsPromise: Option<Promise<Chart[]>>;

	constructor() {
		super();

		this.http = axios.create({
			baseURL: 'https://api.spotify.com/v1',
		});
	}

	private async _getClientToken(): Promise<string> {
		const response = await axios.post('https://clienttoken.spotify.com/v1/clienttoken', {
			client_data: {
				client_version: '1.2.1.53.g789bae87',
				client_id: 'd8a5ed958d274c2e8ee717e6a4b0971d',
				js_sdk_data: {
					device_brand: 'unknown',
					device_model: 'desktop',
					os: 'Windows',
					os_version: 'NT 10.0',
				},
			},
		}, {
			headers: {
				accept: 'application/json',
			},
		});

		this._clientToken = response.data.granted_token.token as string;
		this._clientTokenPromise = undefined;

		return this._clientToken;
	}

	private async getClientToken(): Promise<string> {
		if (this._clientToken) return this._clientToken;
		if (this._clientTokenPromise) return this._clientTokenPromise;

		return this._clientTokenPromise = this._getClientToken();
	}

	private async _getAccessToken() {
		const response = await axios.get<TokenRefreshResponse>('https://open.spotify.com/get_access_token');

		this._accessToken = {
			token: response.data.accessToken,
			expires: response.data.accessTokenExpirationTimestampMs,
		};
		this._accessTokenPromise = undefined;

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
			uid: track.id,
			type: ProviderOrigin.Spotify,
			thumbnail: track.album?.images?.[0]?.url ?? '',
		};
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public static gqlTrackToSongData(track: any): SongData {
		return {
			title: track.track.name,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			artist: track.track.artists.items.map((artist: any) => artist.profile.name).join(', '),
			url: '',
			live: false,
			id: track.track.id,
			uid: track.track.id,
			type: ProviderOrigin.Spotify,
			thumbnail: track.track.albumOfTrack.coverArt.sources[0].url,
			duration: track.track.duration.totalMilliseconds,
		};
	}

	private async _addChartCategory(id: string, batches: number, start = 0) {
		if (batches === 0) return;

		return bufferUnordered(Array.from({ length: batches }, _ => undefined), async (_, index) => {
			const response = await this.http.get<Content<Container<Chart>>>(`/views/${id}`, {
				headers: {
					authorization: `Bearer ${await this.getAccessToken()}`,
					'client-token': await this.getClientToken(),
				},
				params: {
					offset: index * MAX_BATCH_SIZE_CHART_CATEGORY + start,
					limit: MAX_BATCH_SIZE_CHART_CATEGORY,
					platform: 'web',
					types: 'album,playlist',
				},
			});

			this._charts.data.push(...response.data.content.items);
		});
	}

	private async _getCharts(): Promise<Chart[]> {
		this._charts.data = [];

		// container of chart containers
		const response = await this.http.get<Content<Container<Content<Container<Chart>>>>>('/views/browse-charts-tab', {
			headers: {
				authorization: `Bearer ${await this.getAccessToken()}`,
			},
			params: {
				platform: 'web',
				content_limit: 25,
				limit: MAX_BATCH_SIZE_CHART_CATEGORY,
				types: 'album,playlist',
			},
		});

		for (const container of response.data.content.items) {
			this._charts.data.push(...container.content.items);

			await this._addChartCategory(
				container.id,
				Math.ceil((container.content.total - 25) / MAX_BATCH_SIZE_CHART_CATEGORY),
				25
			);
		}

		return this._charts.data;
	}

	public async getCharts(): Promise<Result<Chart[]>> {
		if (this._charts?.expires !== undefined && this._charts.expires > Date.now()) {
			return { ok: true, value: this._charts.data };
		}

		this._chartsPromise = this._getCharts();

		const response = await this._chartsPromise;
		this._chartsPromise = undefined;

		return { ok: true, value: response };
	}

	public async getTrack(id: string): Promise<Result<SearchResult>> {
		const cached = await getCachedSong(id);
		if (cached) {
			// Remove the unique id
			// @ts-expect-error - _id is not a property of SongData
			cached._id = undefined;

			return {
				ok: true,
				value: {
					videos: [cached],
					title: undefined,
				},
			};
		}

		const response = await this.http.get<Track>(`/tracks/${id}`, {
			headers: {
				authorization: `Bearer ${await this.getAccessToken()}`,
				'client-token': await this.getClientToken(),
				'spotify-app-version': '1.2.1.53.g789bae87',
			},
			params: {
				market: 'AX',
			},
		});

		if (response.status !== 200) return { ok: false, error: `Could not find a track by the id \`${id}\`.` };

		return {
			ok: true,
			value: Provider.songDataToSearchResult(SpotifyProvider.trackToSongData(response.data)),
		};
	}

	public async getAlbum(id: string): Promise<Result<SearchResult>> {
		const response = await this.http.get<AlbumMetadata>(`/albums/${id}`, {
			headers: {
				authorization: `Bearer ${await this.getAccessToken()}`,
				'client-token': await this.getClientToken(),
				'spotify-app-version': '1.2.1.53.g789bae87',
			},
			params: {
				limit: MAX_BATCH_SIZE_ALBUM,
				// use an obscure market to stay anonymous
				market: 'AX',
			},
		});

		const defaultThumbnail = response.data.images[0].url;

		if (response.status !== 200) return { ok: false, error: `Could not find an album by the id \`${id}\`.` };

		const total = response.data.tracks.total;
		const batches = Math.ceil(total / MAX_BATCH_SIZE_ALBUM) - 1;

		const tracks = await bufferUnordered(Array.from({ length: batches }, _ => undefined), async (_, index) => {
			const response = await this.http.get<Container<Track>>(`/albums/${id}/tracks`, {
				headers: {
					authorization: `Bearer ${await this.getAccessToken()}`,
					'client-token': await this.getClientToken(),
					'spotify-app-version': '1.2.1.53.g789bae87',
				},
				params: {
					offset: index * MAX_BATCH_SIZE_ALBUM + MAX_BATCH_SIZE_ALBUM,
					limit: MAX_BATCH_SIZE_ALBUM,
					market: 'AX',
				},
			});

			return response.data.items;
		});

		tracks.push(response.data.tracks.items);

		return {
			ok: true,
			value: {
				title: response.data.name,
				videos: tracks.flat().map(track => {
					if (!track.album?.images?.[0]?.url) {
						track.album = {
							images: [
								{
									url: defaultThumbnail,
								},
							],
						};
					}

					return SpotifyProvider.trackToSongData(track);
				}),
			},
		};
	}

	public async getPlaylist(id: string): Promise<Result<SearchResult>> {
		const response = await this.http.get<PlaylistMetadata>(`/playlists/${id}`, {
			headers: {
				authorization: `Bearer ${await this.getAccessToken()}`,
				'client-token': await this.getClientToken(),
				'spotify-app-version': '1.2.1.53.g789bae87',
			},
			params: {
				limit: MAX_BATCH_SIZE_PLAYLIST,
				additional_types: 'track',
				fields: 'name,owner(display_name),public,tracks(total,offset,limit,items(track(album(images),name,duration_ms,id,artists(name))))',
			},
		});

		if (response.status !== 200) return { ok: false, error: `Could not find a playlist by the id \`${id}\`.` };

		const total = response.data.tracks.total;
		const batches = Math.ceil(total / MAX_BATCH_SIZE_PLAYLIST) - 1;

		const tracks = await bufferUnordered(Array.from({ length: batches }, _ => undefined), async (_, index) => {
			const response = await this.http.get<Container<PaginatedTrack>>(`/playlists/${id}/tracks`, {
				headers: {
					authorization: `Bearer ${await this.getAccessToken()}`,
					'client-token': await this.getClientToken(),
					'spotify-app-version': '1.2.1.53.g789bae87',
				},
				params: {
					offset: index * MAX_BATCH_SIZE_PLAYLIST + MAX_BATCH_SIZE_PLAYLIST,
					limit: MAX_BATCH_SIZE_PLAYLIST,
					additional_types: 'track',
					fields: 'items(track(album(images),id,name,duration_ms,artists(name)))',
				},
			});

			return response.data.items.map(item => item.track);
		});

		tracks.push(response.data.tracks.items.map(item => item.track));

		return {
			ok: true,
			value: {
				title: response.data.name,
				videos: tracks.flat().map(SpotifyProvider.trackToSongData),
			},
		};
	}

	public async getArtistTracks(id: string): Promise<Result<SearchResult>> {
		const response = await axios.get('https://api-partner.spotify.com/pathfinder/v1/query', {
			headers: {
				authorization: `Bearer ${await this.getAccessToken()}`,
				'client-token': await this.getClientToken(),
				'spotify-app-version': '1.2.1.53.g789bae87',
			},
			params: {
				operationName: 'queryArtistOverview',
				variables: JSON.stringify({
					uri: `spotify:artist:${id}`,
					locale: 'en',
				}),
				extensions: JSON.stringify({
					persistedQuery: {
						version: 1,
						sha256Hash: '0b84fdc8c874d3020a119be614b8f0ee0f08c69c1c37aeb0a8b17758f63ef7fe',
					},
				}),
			},
		});

		if (response.status !== 200) return { ok: false, error: `Could not find an artist by the id \`${id}\`.` };

		const tracks: SongData[] = response.data.data.artistUnion.discography.topTracks.items.map(SpotifyProvider.gqlTrackToSongData);

		return {
			ok: true,
			value: {
				title: `Top Tracks from ${response.data.data.artistUnion.profile.name}`,
				videos: tracks,
			},
		};
	}
}
