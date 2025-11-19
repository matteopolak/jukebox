import prism from 'prism-media';
import { Duplex, Readable } from 'stream';
import { ClientType, Innertube, Platform, Types, UniversalCache, Utils } from 'youtubei.js';

const { opus: Opus, FFmpeg } = prism;

type Encoder = prism.opus.Encoder;
type FFmpeg = prism.FFmpeg;

Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
	const properties = [];

	if (env.n) {
		properties.push(`n: exportedVars.nFunction("${env.n}")`);
	}

	if (env.sig) {
		properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
	}

	const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

	return new Function(code)();
};

export interface StreamOptions {
	seek?: number;
	encoderArgs?: string[];
	fmt?: string;
	opusEncoded?: boolean;
	quality?: 'best' | 'high' | 'medium' | 'low';
}

let innertubePromise: Promise<Innertube> | null = null;

function getInnertube(): Promise<Innertube> {
	if (!innertubePromise) {
		innertubePromise = Innertube.create({
			cache: new UniversalCache(false),
			generate_session_locally: true,
			cookie: process.env.COOKIE,
			client_type: ClientType.TV,
		});
	}
	return innertubePromise;
}

/**
 * Create an audio stream for a YouTube video with custom FFmpeg encoding options
 * @param url - YouTube URL or video ID
 * @param options - Stream options
 * @example
 * const stream = await createAudioStream("dQw4w9WgXcQ", {
 *     seek: 3,
 *     encoderArgs: ["-af", "bass=g=10"],
 *     opusEncoded: true
 * });
 * voiceConnection.play(stream, { type: "opus" });
 */
export async function createAudioStream(
	url: string,
	options?: StreamOptions
): Promise<Encoder | FFmpeg> {
	if (!url) {
		throw new Error('No input url provided');
	}
	if (typeof url !== 'string') {
		throw new SyntaxError(`input URL must be a string. Received ${typeof url}!`);
	}

	options = options ?? {};

	const videoId = url.match(/(?:v=|\/)([\w-]{11})/)?.[1] ?? url;

	let FFmpegArgs: string[] = [
		'-analyzeduration',
		'0',
		'-loglevel',
		'0',
		'-f',
		`${typeof options.fmt === 'string' ? options.fmt : 's16le'}`,
		'-ar',
		'48000',
		'-ac',
		'2',
	];

	if (!isNaN(options.seek as number)) {
		FFmpegArgs.unshift('-ss', (options.seek as number).toString());
	}

	if (Array.isArray(options.encoderArgs)) {
		FFmpegArgs = FFmpegArgs.concat(options.encoderArgs);
	}

	const innertube = await getInnertube();
	const info = await innertube.getBasicInfo(videoId);

	const webStream = await info.download({
		type: 'audio',
		quality: options.quality ?? 'best',
		client: 'TV',
	});

	const stream = Readable.from(Utils.streamToIterable(webStream));

	const transcoder = new FFmpeg({
		args: [
			'-i', 'pipe:0',
			...FFmpegArgs,
		],
	});

	stream.pipe(transcoder);
	stream.on('error', (err: Error) => {
		console.error('[Stream] Download error:', err);
		transcoder.destroy();
	});

	if (options && !options.opusEncoded) {
		transcoder.on('close', () => transcoder.destroy());
		return transcoder;
	}

	const opus = new Opus.Encoder({
		rate: 48000,
		channels: 2,
		frameSize: 960,
	});

	const outputStream = transcoder.pipe(opus);

	outputStream.on('close', () => {
		transcoder.destroy();
		opus.destroy();
	});

	return outputStream;
}

/**
 * Creates an audio stream from an arbitrary source (URL or stream)
 * @param source - Any readable stream source or URL
 * @param options - Stream options
 * @example
 * const stream = arbitraryStream("https://listen.moe/kpop/opus", {
 *     encoderArgs: ["-af", "bass=g=10"],
 *     opusEncoded: true
 * });
 * voiceConnection.play(stream, { type: "opus" });
 */
export function arbitraryStream(
	source: string | Readable | Duplex,
	options?: StreamOptions
): Encoder | FFmpeg {
	if (!source) {
		throw new Error('No stream source provided');
	}

	options = options ?? {};

	let FFmpegArgs: string[];

	if (typeof source === 'string') {
		FFmpegArgs = [
			'-reconnect',
			'1',
			'-reconnect_streamed',
			'1',
			'-reconnect_delay_max',
			'5',
			'-i',
			source,
			'-analyzeduration',
			'0',
			'-loglevel',
			'0',
			'-f',
			`${typeof options.fmt === 'string' ? options.fmt : 's16le'}`,
			'-ar',
			'48000',
			'-ac',
			'2',
		];
	} else {
		FFmpegArgs = [
			'-analyzeduration',
			'0',
			'-loglevel',
			'0',
			'-f',
			`${typeof options.fmt === 'string' ? options.fmt : 's16le'}`,
			'-ar',
			'48000',
			'-ac',
			'2',
		];
	}

	if (!isNaN(options.seek as number)) {
		FFmpegArgs.unshift('-ss', (options.seek as number).toString());
	}

	if (Array.isArray(options.encoderArgs)) {
		FFmpegArgs = FFmpegArgs.concat(options.encoderArgs);
	}

	let transcoder = new FFmpeg({
		args: FFmpegArgs,
	});

	if (typeof source !== 'string') {
		transcoder = source.pipe(transcoder);
		source.on('error', () => transcoder.destroy());
	}

	if (options && !options.opusEncoded) {
		transcoder.on('close', () => transcoder.destroy());
		return transcoder;
	}

	const opus = new Opus.Encoder({
		rate: 48000,
		channels: 2,
		frameSize: 960,
	});

	const outputStream = transcoder.pipe(opus);
	outputStream.on('close', () => {
		transcoder.destroy();
		opus.destroy();
	});

	return outputStream;
}
