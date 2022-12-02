import { Result, SearchResult, SongData } from '@/typings/common';

export const enum SearchType {
	Video = 'EgIQAQ%253D%253D',
	Playlist = 'EgIQAw%253D%253D'
}

export interface SearchOptions {
	type: SearchType;
}

export class Provider {
	public async getTrack(id: string): Promise<Result<SearchResult, string>> {
		return { ok: false, error: `Could not find a track with the id \`${id}\`.` };
	}

	public async getPlaylist(id: string): Promise<Result<SearchResult, string>> {
		return { ok: false, error: `Could not find a playlist with the id \`${id}\`.` };
	}

	public async getAlbum(id: string): Promise<Result<SearchResult, string>> {
		return { ok: false, error: `Could not find a album with the id \`${id}\`.` };
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	public async search(query: string, options: SearchOptions): Promise<Result<SearchResult, string>> {
		return { ok: false, error: `Could not find any results for the query \`${query}\`.` };
	}

	public static songDataToSearchResult(songData: SongData): SearchResult {
		return {
			title: undefined,
			videos: [songData],
		};
	}
}
