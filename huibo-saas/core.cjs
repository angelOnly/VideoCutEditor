const {createHash} = require('node:crypto');

const ORIGIN = 'https://huibo.baidu.com';
const ENDPOINTS = Object.freeze({
  avatars: '/ai_anchor/smart_anchor/list',
  price: '/ai_video/b_platform/video/calculate_price',
  make: '/ai_video/b_platform/video/v2/make',
  query: '/ai_video/b_platform/video/query',
});

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(message) { throw new ApiError(400, 'INVALID_INPUT', message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function id(value, name) {
  if (!['string', 'number'].includes(typeof value) || !String(value).trim() || String(value).length > 200) fail(`${name} 必须是非空 ID`);
  return value;
}

// 与 2026-09-07 网页构建中的 POSTJSON 签名格式一致。
// 这是公开前端请求校验，不代替用户 Cookie、权限和平台人机验证。
function signedURL(path, body, timestamp = Math.floor(Date.now() / 1000)) {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN || !Object.values(ENDPOINTS).includes(url.pathname)) throw new Error('Endpoint not allowed');
  const query = url.search.slice(1);
  const canonical = new URLSearchParams(`${query || '?'}${query ? '&' : ''}timestamp=${timestamp}&ak=huibo_fe`);
  const pairs = [...canonical].filter(([key]) => key !== 'sign').sort();
  const encoded = new URLSearchParams(pairs).toString();
  const signature = createHash('md5').update(`huibo_fe123qaz_huibo_fe_321plm${timestamp}${url.pathname}${encoded}${body}`).digest('hex');
  const addition = `ak=huibo_fe&timestamp=${timestamp}&sign=${signature}${query ? '&' + query : ''}`;
  url.search = query ? `?${query}&${addition}` : `?${addition}`;
  return url.toString();
}

function videoPayload(input) {
  if (!object(input)) fail('请求体必须是 JSON 对象');
  const allowed = ['text', 'avatar_id', 'voice', 'title', 'screen', 'subtitles', 'background_music'];
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('存在不支持的参数');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length >= 3000) fail('text 必须为 1–2999 字');
  if (!object(input.voice)) fail('voice 必须为音色参数对象（可从形象返回数据中的 voice_list 获取）');
  id(input.voice.tts_mid, 'voice.tts_mid');
  const voice = {...input.voice};
  if (voice.tts_speed === undefined) voice.tts_speed = 5;
  const speed = Number(voice.tts_speed);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 15) fail('voice.tts_speed 超出范围');
  for (const field of ['tts_speed', 'tts_tone', 'tts_volume']) {
    voice[field] = voice[field] ? (typeof voice[field] === 'number' ? voice[field].toFixed(1) : voice[field]) : '';
  }
  voice.tts_timbre_id = voice.tts_timbre_id || (voice.tts_per ? String(voice.tts_per) : undefined);
  voice.tts_per_new = voice.tts_timbre_id;
  voice.tts_per = Number.isNaN(Number(voice.tts_timbre_id)) ? 0 : Number(voice.tts_timbre_id);
  voice.tts_vc_per = voice.mood && voice.tts_vc_per ? voice.tts_vc_per : '';
  voice.tts_mood = voice.mood && voice.tts_vc_per ? voice.mood : '';
  const screen = input.screen ?? '9:16';
  if (!['9:16', '16:9'].includes(screen)) fail('screen 仅支持 9:16 或 16:9');
  for (const key of ['subtitles', 'background_music']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail(`${key} 必须是布尔值`);
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100)) fail('title 必须为 1–100 字');
  const text = input.text.trim();
  return {
    vis_figure_id: id(input.avatar_id, 'avatar_id'), figure_info: {type: 1},
    video_type: 2, strategy_type: 0, business_scene: 0, screen: screen === '9:16' ? 0 : 1,
    need_bgm: input.background_music ? 1 : 0, need_subtitle: input.subtitles === false ? 0 : 1,
    need_watermark: 1, need_high_light_subtitle: input.subtitles === false ? 1 : 0,
    subtitle_style: '', materials: [], voice_param: voice,
    task_list: [{script_task_id: null, generate_script: text, script_version: 2,
      title: input.title || text.slice(0, 20), pronunciation_script: [{type: 'blocks', children: [{text}]}]}],
    need_wait: 0, version: 4, script_version: 2,
  };
}
function pricePayload(payload) {
  return {benefits: payload.task_list.map(task => ({benefits_id: 1014,
    fee_attribute: {word_count: task.generate_script.length, speed_ratio: Number(payload.voice_param.tts_speed || 5) / 5}}))};
}
function costTotals(cost) {
  const coins = cost?.cost_total?.coin_total;
  const quota = cost?.cost_total?.quota;
  if (!['string', 'number'].includes(typeof coins) || !['string', 'number'].includes(typeof quota)
    || String(coins).trim() === '' || String(quota).trim() === ''
    || !Number.isFinite(Number(coins)) || !Number.isFinite(Number(quota)) || Number(coins) < 0 || Number(quota) < 0) {
    throw new ApiError(502, 'UNKNOWN_COST', '费用响应结构不符合预期，停止提交');
  }
  return {coins: Number(coins), quota: Number(quota)};
}
function checkLimits(cost, limits) {
  const {coins, quota} = costTotals(cost);
  for (const key of ['max_coins', 'max_quota']) if (typeof limits[key] !== 'number' || !Number.isFinite(limits[key]) || limits[key] < 0) fail(`${key} 必须为非负数字`);
  if (coins > limits.max_coins || quota > limits.max_quota) throw new ApiError(409, 'COST_LIMIT', '最新费用超出本次调用授权上限');
}
function unwrap(result) {
  if (!object(result) || typeof result.errno !== 'number') throw new ApiError(502, 'UPSTREAM_FORMAT', '一镜响应结构变化或登录跳转');
  if (result.errno !== 0) throw new ApiError(502, `HUIBO_${result.errno}`, String(result.errmsg || '一镜拒绝请求').slice(0, 250));
  if (!object(result.data)) throw new ApiError(502, 'UPSTREAM_FORMAT', '一镜响应缺少 data');
  return result.data;
}
module.exports = {ApiError, ORIGIN, ENDPOINTS, signedURL, videoPayload, pricePayload, costTotals, checkLimits, unwrap};
