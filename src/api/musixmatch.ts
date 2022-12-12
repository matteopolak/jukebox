import { createHmac } from 'node:crypto';

import axios from 'axios';

import { Option } from '@/typings/common';
import {
	MusixmatchResponse,
	Track as TrackData,
	TrackGetResponse,
	TrackLyricsResponse,
	TrackSearchResponse,
} from '@/typings/musixmatch';
import { TrackWithArtist } from '@/util/database';
import { cleanTitle } from '@/util/music';

type ParamValueType = string | number | boolean | undefined;

const SIGNATURE_SECRET = '29737bc85caf771125962a9b8c8b58476342d6f7';

// reverse-engineered from the Musixmatch webapp
export function createSignedUrl(
	url: string,
	params: Record<string, ParamValueType> = {}
) {
	const fullUrl = `${url}?${serializeParams(params)}`;

	const date = new Date();
	const year = date.getUTCFullYear();
	const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
	const day = date.getUTCDate().toString().padStart(2, '0');

	const hasher = createHmac('sha1', SIGNATURE_SECRET);

	hasher.update(`${fullUrl}${year}${month}${day}`);
	const hash = hasher.digest('base64');

	const signed = `${fullUrl}&signature=${encodeURIComponent(
		hash
	)}&signature_protocol=sha1`;

	return signed;
}

export function serializeParams(params: Record<string, ParamValueType>) {
	const serialized: string[] = ['app_id=community-app-v1.0', 'format=json'];

	for (const key in params) {
		if (params[key] === undefined) continue;

		serialized.push(
			`${encodeURIComponent(key)}=${encodeURIComponent(params[key]!).replace(
				/'/g,
				''
			)}`
		);
	}

	return serialized.join('&');
}

export const enum QueryType {
	Title = 'q_track',
	Artist = 'q_artist',
	Lyrics = 'q_lyrics',
	TitleOrArtist = 'q_track_artist',
}

export async function getTrackDataById(trackId: number): Promise<Option<TrackData>> {
	const url = createSignedUrl('https://www.musixmatch.com/ws/1.1/track.get', {
		track_id: trackId,
	});

	const { data } = await axios.get<
		MusixmatchResponse<TrackGetResponse>
	>(url);

	return data.message.header.status_code === 404
		? null
		: data.message.body?.track ?? null;
}

export async function getTrackData(
	query: Partial<Record<QueryType, string>>,
	lyrics = true
): Promise<Option<TrackData>> {
	const url = createSignedUrl(
		'https://www.musixmatch.com/ws/1.1/track.search',
		{
			...query,
			part: 'artist_image',
			page_size: '1',
			f_has_lyrics: lyrics ? '1' : undefined,
		}
	);

	const { data } = await axios.get<MusixmatchResponse<TrackSearchResponse>>(
		url
	);

	if (data.message?.header?.status_code !== 200) return null;
	return data.message.body?.track_list[0]?.track ?? null;
}

export async function getLyricsById(trackId: number): Promise<Option<string>> {
	const url = createSignedUrl(
		'https://www.musixmatch.com/ws/1.1/track.lyrics.get',
		{
			track_id: trackId,
		}
	);

	const { data } = await axios.get<MusixmatchResponse<TrackLyricsResponse>>(
		url
	);

	if (data.message?.header?.status_code !== 200) return null;

	return data.message.body!.lyrics.lyrics_body;
}

export async function getTrackDataFromTrack(
	data: TrackWithArtist
): Promise<Option<TrackData>> {
	if (data.musixmatchId === -1) return null;
	if (data.musixmatchId) return getTrackDataById(data.musixmatchId);

	const clean = cleanTitle(data.title);

	{
		const track = await getTrackData(
			{ q_track: clean, q_artist: data.artist.name },
			true
		);

		if (track) return track;
	}

	{
		const track = await getTrackData({ q_track_artist: clean }, true);

		if (track) return track;
	}

	return null;
}

export async function getTrackIdFromTrack(
	data: TrackWithArtist
): Promise<Option<number>> {
	if (data.musixmatchId !== null) return data.musixmatchId;

	const clean = cleanTitle(data.title).replace(
		/[\u0000-\u001F\u007F-\u009F]/g,
		''
	);

	{
		const track = await getTrackData(
			{
				q_track: clean,
				q_artist: data.artist.name.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''),
			},
			true
		);

		if (track) return track.track_id;
	}

	{
		const track = await getTrackData({ q_track_artist: clean }, true);

		if (track) return track.track_id;
	}

	return null;
}
