/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { CatalogVoiceOption } from '../common/basehalfProviderTypes.js';

/**
 * The system voices of the Qwen-Audio speech models, as Alibaba's voice list
 * gives them (`qwen-audio-tts-voice-list`, read on 2026-11-11, updated
 * 2026-10-29; docs/specs/providers/alibaba.md, "Voices of the speech models").
 * A voice belongs to one model. Each voice is its id, its name on the list,
 * and its gender with a few words of what the list says of it, in English,
 * in one place to translate later.
 */

/** A voice of the list: its id, its name, and its description. */
type VoiceRow = readonly [id: string, label: string, description: string];

/** The region of the voices that China (Beijing) alone offers. */
const CHINA: readonly string[] = Object.freeze(['cn']);

function options(rows: readonly VoiceRow[], regions?: readonly string[]): CatalogVoiceOption[] {
	return rows.map(([value, label, description]) => ({ value, label, description, ...(regions ? { regions } : {}) }));
}

/** The voice of the launch film, a flagship voice of 3.1 TTS Plus and Flash in both regions. */
export const QWEN_AUDIO_31_DEFAULT_VOICE = 'longanhuan_v3.1';
export const QWEN_AUDIO_30_PLUS_DEFAULT_VOICE = 'longanlingxin';
export const QWEN_AUDIO_30_FLASH_DEFAULT_VOICE = 'longanhuan_v3.6';

/** The flagship voices of 3.1 TTS Plus and Flash: Mandarin, eight dialects, and eight other languages; the default first. */
const FLAGSHIP: readonly VoiceRow[] = [
	[QWEN_AUDIO_31_DEFAULT_VOICE, 'Long An Huan', 'Female · Flagship: Mandarin, dialects, and other languages'],
	['longanlingxin_v3.1', 'Long An Lingxin', 'Female · Flagship: Mandarin, dialects, and other languages'],
	['xunanchuan_v3.1', 'Xu Nanchuan', 'Male · Flagship: Mandarin, dialects, and other languages'],
	['longanfengyue_v3.1', 'Long An Fengyue', 'Female · Flagship: Mandarin, dialects, and other languages']
];

/** The premium Chinese voices of 3.1 TTS Flash, Mandarin, China (Beijing) only. */
const PREMIUM_CHINESE: readonly VoiceRow[] = [
	['yuxiaoyun_v3.1', 'Yu Xiaoyun', 'Female · Energetic, friendly · Mandarin'],
	['qiaoxiaojiao_v3.1', 'Qiao Xiaojiao', 'Female · Charming, cute · Mandarin'],
	['xiaxiaochen_v3.1', 'Xia Xiaochen', 'Female · Energetic, bright · Mandarin'],
	['anmingyuan_v3.1', 'An Mingyuan', 'Male · Clear, natural · Mandarin'],
	['wenhuaiqing_v3.1', 'Wen Huaiqing', 'Female · Clear, soft · Mandarin'],
	['anxiaolan_v3.1', 'An Xiaolan', 'Female · Sweet, clear · Mandarin'],
	['xieshurou_v3.1', 'Xie Shurou', 'Female · Soft, intellectual · Mandarin'],
	['baiqinglan_v3.1', 'Bai Qinglan', 'Female · Bright, youthful · Mandarin'],
	['xuyuyuan_v3.1', 'Xu Yuyuan', 'Female · Intellectual, mature · Mandarin'],
	['anruorou_v3.1', 'An Ruorou', 'Female · Breathy, intellectual · Mandarin'],
	['wenhuaizhi_v3.1', 'Wen Huaizhi', 'Female · Composed, mature · Mandarin'],
	['xiaoxingzhi_v3.1', 'Xiao Xingzhi', 'Female · Dignified, elegant · Mandarin'],
	['guyunshu_v3.1', 'Gu Yunshu', 'Female · Mature, composed · Mandarin'],
	['huozhuoshi_v3.1', 'Huo Zhuoshi', 'Male · Clear · Mandarin'],
	['yeqinghe_v3.1', 'Ye Qinghe', 'Female · Friendly, gentle · Mandarin'],
	['yunhuanhuan_v3.1', 'Yun Huanhuan', 'Female · High-pitched, enthusiastic · Mandarin'],
	['xuxiaoqiao_v3.1', 'Xu Xiaoqiao', 'Female · Natural, playful · Mandarin'],
	['baianran_v3.1', 'Bai Anran', 'Female · Low-pitched, resonant · Mandarin'],
	['xuyanchu_v3.1', 'Xu Yanchu', 'Female · Steady, magnetic · Mandarin'],
	['yezhiqing_v3.1', 'Ye Zhiqing', 'Female · Light, natural · Mandarin'],
	['andi_v3.1', 'An Di', 'Male · American-born Chinese accent · Mandarin'],
	['anyuqing_v3.1', 'An Yuqing', 'Female · Sweet · Mandarin'],
	['linxiaoling_v3.1', 'Lin Xiaoling', 'Female · Sweet · Mandarin'],
	['longfeifei_v3.1', 'Long Feifei', 'Female · Sweet · Mandarin'],
	['longjing_v3.1', 'Long Jing', 'Female · Rich, steady · Mandarin'],
	['longqiang_v3.1', 'Long Qiang', 'Female · Romantic, charming · Mandarin'],
	['longyan_v3.1', 'Long Yan', 'Female · Warm, friendly · Mandarin'],
	['longxiaobai_v3.1', 'Long Xiaobai', 'Female · Magnetic, rich · Mandarin'],
	['longyue_v3.1', 'Long Yue', 'Female · Warm, magnetic · Mandarin'],
	['longcheng_v3.1', 'Long Cheng', 'Male · Wise, magnetic · Mandarin'],
	['longlaotie_v3.1', 'Long Laotie', 'Male · Northeastern accent, straightforward · Mandarin'],
	['longshao_v3.1', 'Long Shao', 'Male · Positive, energetic · Mandarin'],
	['longshu_v3.1', 'Long Shu', 'Male · Steady, magnetic · Mandarin'],
	['longze_v3.1', 'Long Ze', 'Male · Warm, energetic · Mandarin'],
	['longhao_v3.1', 'Long Hao', 'Male · Sentimental, melancholic · Mandarin'],
	['longjin_v3.1', 'Long Jin', 'Male · Elegant, gentle · Mandarin'],
	['longnan_v3.1', 'Long Nan', 'Male · Insightful · Mandarin'],
	['longshuo_v3.1', 'Long Shuo', 'Male · Knowledgeable, businesslike · Mandarin'],
	['longtian_v3.1', 'Long Tian', 'Male · Magnetic, rational · Mandarin'],
	['longxiaocheng_v3.1', 'Long Xiaocheng', 'Male · Magnetic, low-pitched · Mandarin'],
	['longke_v3.1', 'Long Ke', 'Child · Innocent · Mandarin'],
	['loongbella_v3.1', 'Bella', 'Female · Businesslike, magnetic · Mandarin and English']
];

/** The other system voices of 3.1 TTS Flash, China (Beijing) only. */
const OTHER_SYSTEM: readonly VoiceRow[] = [
	['longanyuanfei_v3.1', 'Long An Yuanfei', 'Female · A haughty royal consort'],
	['longjielidou_v3.1', 'Long Jielidou', 'Male · An innocent young boy'],
	['longanlingxi_v3.1', 'Long An Lingxi', 'Female · Cute, sweet'],
	['longhuohuo_v3.1', 'Long Huohuo', 'Male · A mischievous teenage boy'],
	['longyingtao_v3.1', 'Long Yingtao', 'Female · Gentle, calm'],
	['longanya_v3.1', 'Long An Ya', 'Female · Elegant'],
	['longwan_v3.1', 'Long Wan', 'Female · Delicate, soft'],
	['longxing_v3.1', 'Long Xing', 'Female · The gentle girl next door'],
	['longhua_v3.1', 'Long Hua', 'Female · Energetic, sweet'],
	['longhan_v3.1', 'Long Han', 'Male · Warm, devoted'],
	['longanzhi_v3.1', 'Long An Zhi', 'Male · A wise young adult'],
	['longzhe_v3.1', 'Long Zhe', 'Male · Reserved, caring'],
	['longanyang_v3.1', 'Long An Yang', 'Male · A cheerful young man'],
	['libai_v3.1', 'Li Bai', 'Male · A classical poet, for poetry'],
	['longling_v3.1', 'Long Ling', 'Female · A childlike, reserved voice'],
	['longniuniu_v3.1', 'Long Niuniu', 'Male · A cheerful young boy'],
	['longshanshan_v3.1', 'Long Shanshan', 'Male · A theatrical child'],
	['longpaopao_v3.1', 'Long Paopao', 'Female · A bubbly cartoon girl'],
	['loongstella_v3.1', 'loongstella', 'Female · Confident, brisk, for news'],
	['longyuan_v3.1', 'Long Yuan', 'Female · Warm, soothing'],
	['longmiao_v3.1', 'Long Miao', 'Female · Expressive'],
	['longsanshu_v3.1', 'Long Sanshu', 'Male · Steady, textured'],
	['longanli_v3.1', 'Long An Li', 'Female · Poised, efficient'],
	['longanwen_v3.1', 'Long An Wen', 'Female · Elegant, intellectual'],
	['longanlang_v3.1', 'Long An Lang', 'Male · Clear, brisk'],
	['longxiaoxia_v3.1', 'Long Xiaoxia', 'Female · Steady, authoritative'],
	['longanchong_v3.1', 'Long An Chong', 'Male · An enthusiastic salesperson']
];

/** The premium English voices of 3.1 TTS Flash, in both regions. */
const PREMIUM_ENGLISH: readonly VoiceRow[] = [
	['Emily_v3.1', 'Emily', 'Female · British English'],
	['Luna_v3.1', 'Luna', 'Female · British English'],
	['Eric_v3.1', 'Eric', 'Male · British English'],
	['Luca_v3.1', 'Luca', 'Male · British English'],
	['Abby_v3.1', 'Abby', 'Female · American English'],
	['Annie_v3.1', 'Annie', 'Female · American English'],
	['Ava_v3.1', 'Ava', 'Female · American English'],
	['Beth_v3.1', 'Beth', 'Female · American English'],
	['Betty_v3.1', 'Betty', 'Female · American English'],
	['Cally_v3.1', 'Cally', 'Female · American English'],
	['Cindy_v3.1', 'Cindy', 'Female · American English'],
	['Donna_v3.1', 'Donna', 'Female · American English'],
	['Andy_v3.1', 'Andy', 'Male · American English'],
	['Brian_v3.1', 'Brian', 'Male · American English'],
	['David_v3.1', 'David', 'Male · American English']
];

/** The voices of other languages of 3.1 TTS Flash, in both regions: the id's suffix, the name, the gender, and the language. */
const OTHER_LANGUAGES: readonly (readonly [suffix: string, label: string, gender: string, language: string])[] = [
	['zora_bg', 'Zora', 'Male', 'Bulgarian'],
	['linde_nl', 'Linde', 'Male', 'Dutch'],
	['hajnal_hu', 'Hajnal', 'Female', 'Hungarian'],
	['senin_ro', 'Senin', 'Male', 'Romanian'],
	['birk_da', 'Birk', 'Male', 'Danish'],
	['lipa_hr', 'Lipa', 'Male', 'Croatian'],
	['avgi_el', 'Avgi', 'Male', 'Greek'],
	['jitrenka_cs', 'Jitrenka', 'Male', 'Czech'],
	['solglimt_nn', 'Solglimt', 'Male', 'Norwegian'],
	['glimma_sv', 'Glimma', 'Female', 'Swedish'],
	['svar_hi', 'Svar', 'Male', 'Hindi'],
	['iskra_sk', 'Iskra', 'Female', 'Slovak'],
	['aava_fi', 'Aava', 'Male', 'Finnish'],
	['sahar_ur', 'Sahar', 'Male', 'Urdu'],
	['jasna_sr', 'Jasna', 'Male', 'Serbian'],
	['brisa_es_mx', 'Brisa', 'Female', 'Mexican Spanish'],
	['ausra_lt', 'Ausra', 'Male', 'Lithuanian'],
	['rasa_lv', 'Rasa', 'Female', 'Latvian'],
	['deniz_tr', 'Deniz', 'Male', 'Turkish'],
	['ava_fa', 'Ava', 'Male', 'Persian'],
	['or_he', 'Or', 'Male', 'Hebrew'],
	['ayalguu_mn', 'Ayalguu', 'Male', 'Mongolian'],
	['zarja_sl', 'Zarja', 'Male', 'Slovenian'],
	['ishiq_az', 'Ishiq', 'Male', 'Azerbaijani'],
	['zorza_pl', 'Zorza', 'Male', 'Polish'],
	['alba_ca', 'Alba', 'Male', 'Catalan'],
	['romduol_km', 'Romduol', 'Male', 'Khmer'],
	['aurora_pt_br', 'Aurora', 'Male', 'Brazilian Portuguese'],
	['dao_lo', 'Dao', 'Male', 'Lao'],
	['tsiskari_ka', 'Tsiskari', 'Male', 'Georgian'],
	['lente_af', 'Lente', 'Female', 'Afrikaans'],
	['kiran_ne', 'Kiran', 'Male', 'Nepali'],
	['zorka_be', 'Zorka', 'Female', 'Belarusian'],
	['nilaav_ml', 'Nilaav', 'Female', 'Malayalam'],
	['staer_lb', 'Staer', 'Female', 'Luxembourgish'],
	['drita_sq', 'Drita', 'Male', 'Albanian'],
	['nila_ta', 'Nila', 'Female', 'Tamil'],
	['aruna_si', 'Aruna', 'Male', 'Sinhala'],
	['vennela_te', 'Vennela', 'Male', 'Telugu'],
	['sade_et', 'Sade', 'Female', 'Estonian'],
	['bituon_ceb', 'Bituon', 'Male', 'Cebuano'],
	['vedrina_bs', 'Vedrina', 'Female', 'Bosnian'],
	['layaung_my', 'LaYaung', 'Male', 'Burmese'],
	['luys_hy', 'Luys', 'Female', 'Armenian'],
	['lumen_la', 'Lumen', 'Male', 'Latin'],
	['birta_is', 'Birta', 'Male', 'Icelandic'],
	['zerniq_mt', 'Zerniq', 'Female', 'Maltese'],
	['nuru_sw', 'Nuru', 'Female', 'Swahili'],
	['arai_kk', 'Arai', 'Male', 'Kazakh'],
	['zetwal_crs', 'Zetwal', 'Female', 'Seychellois Creole'],
	['zoria_uk', 'Zoria', 'Male', 'Ukrainian']
];

/** The voices of Qwen-Audio 3.1 TTS Plus: its four flagship voices. */
export const QWEN_AUDIO_31_PLUS_VOICES: readonly CatalogVoiceOption[] = Object.freeze(options(FLAGSHIP));

/**
 * The voices of Qwen-Audio 3.1 TTS Flash, in the list's order: the flagship
 * voices; the premium Chinese and the other system voices, which China
 * (Beijing) alone offers; then the premium English voices and those of other
 * languages, which both regions offer.
 */
export const QWEN_AUDIO_31_FLASH_VOICES: readonly CatalogVoiceOption[] = Object.freeze([
	...options(FLAGSHIP),
	...options(PREMIUM_CHINESE, CHINA),
	...options(OTHER_SYSTEM, CHINA),
	...options(PREMIUM_ENGLISH),
	...options(OTHER_LANGUAGES.map(([suffix, label, gender, language]): VoiceRow => [`qwen-audio-3.1-tts-flash-${suffix}`, label, `${gender} · ${language}`]))
]);

/** The voices of Qwen-Audio 3.0 TTS Plus. */
export const QWEN_AUDIO_30_PLUS_VOICES: readonly CatalogVoiceOption[] = Object.freeze(options([
	[QWEN_AUDIO_30_PLUS_DEFAULT_VOICE, 'Long An Ling Xin', 'Female, 25 · Warm, empathetic · Mandarin and English'],
	['longanlufeng', 'Long An Lu Feng', 'Male, 25 · Bright, cheerful · Mandarin and English']
]));

/** The voices of Qwen-Audio 3.0 TTS Flash. */
export const QWEN_AUDIO_30_FLASH_VOICES: readonly CatalogVoiceOption[] = Object.freeze(options([
	[QWEN_AUDIO_30_FLASH_DEFAULT_VOICE, 'Long An Huan', 'Female, 25 · Mandarin and English'],
	['longanfengyue', 'Long An Feng Yue', 'Female, 30 · Natural, friendly · Mandarin and English'],
	['longanyuanfei', 'Long An Yuan Fei', 'Female, 30 · Proud, regal · Mandarin and English'],
	['longanlingxi', 'Long An Ling Xi', 'Female, 25 · Cute, sweet · Mandarin and English'],
	['longanxiaoxin', 'Long An Xiao Xin', 'Female, 22 · Friendly, lively · Mandarin and English'],
	['longjielidou_v3.6', 'Long Jie Li Dou', 'Male, 5 · An innocent young boy · Mandarin and English'],
	['longpaopao_v3.6', 'Long Pao Pao', 'Female, 5 · Soft, adorable · Mandarin and English'],
	['longhuohuo_v3.6', 'Long Huo Huo', 'Male, 8 · A mischievous young boy · Mandarin and English'],
	['longchuanshu_v3.6', 'Long Chuan Shu', 'Male, 40 · A Sichuan accent · Mandarin and English'],
	['loongmary', 'loongmary', 'Female, 20 · A warm British accent · English'],
	['loongeva_v3.6', 'loongeva', 'Female, 28 · An American accent · English'],
	['loongjohn', 'loongjohn', 'Male, 28 · A calm, friendly American accent · English']
]));
