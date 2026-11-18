// 가상 회원 이름. 실제 사람과 겹쳐도 흔한 성·이름 조합일 뿐이고, 연락처·이메일은 가상 도메인이다.

export const SURNAMES: readonly [ko: string, en: string, weight: number][] = [
  ["김", "KIM", 21.5], ["이", "LEE", 14.7], ["박", "PARK", 8.4], ["최", "CHOI", 4.7], ["정", "JUNG", 4.3],
  ["강", "KANG", 2.3], ["조", "CHO", 2.1], ["윤", "YOON", 2.1], ["장", "JANG", 2.0], ["임", "LIM", 1.7],
  ["한", "HAN", 1.5], ["오", "OH", 1.5], ["서", "SEO", 1.5], ["신", "SHIN", 1.5], ["권", "KWON", 1.4],
  ["황", "HWANG", 1.4], ["안", "AHN", 1.4], ["송", "SONG", 1.4], ["류", "RYU", 1.2], ["전", "JEON", 1.1],
  ["홍", "HONG", 1.1], ["고", "KO", 0.9], ["문", "MOON", 0.9], ["양", "YANG", 0.9], ["손", "SON", 0.9],
  ["배", "BAE", 0.8], ["백", "BAEK", 0.8], ["허", "HEO", 0.6], ["유", "YOO", 0.6], ["남", "NAM", 0.6],
];

type Given = readonly [ko: string, en: string];

/** 1950~60년대생에 흔한 이름. */
export const OLDER: Record<"F" | "M", readonly Given[]> = {
  F: [
    ["영희", "YOUNGHEE"], ["미숙", "MISOOK"], ["정희", "JUNGHEE"], ["순자", "SOONJA"], ["경숙", "KYUNGSOOK"],
    ["명숙", "MYUNGSOOK"], ["숙희", "SOOKHEE"], ["정숙", "JUNGSOOK"], ["옥순", "OKSOON"], ["영숙", "YOUNGSOOK"],
    ["미경", "MIKYUNG"], ["순희", "SOONHEE"], ["혜숙", "HYESOOK"], ["경자", "KYUNGJA"], ["은숙", "EUNSOOK"],
  ],
  M: [
    ["영수", "YOUNGSOO"], ["철수", "CHULSOO"], ["정호", "JUNGHO"], ["상철", "SANGCHUL"], ["영호", "YOUNGHO"],
    ["광수", "KWANGSOO"], ["병철", "BYUNGCHUL"], ["용수", "YONGSOO"], ["만수", "MANSOO"], ["성호", "SUNGHO"],
    ["종식", "JONGSIK"], ["재근", "JAEGEUN"], ["기철", "KICHUL"], ["동수", "DONGSOO"], ["명호", "MYUNGHO"],
  ],
};

/** 1970~80년대생. */
export const MIDDLE: Record<"F" | "M", readonly Given[]> = {
  F: [
    ["은정", "EUNJUNG"], ["혜진", "HYEJIN"], ["지현", "JIHYUN"], ["수진", "SUJIN"], ["현주", "HYUNJOO"],
    ["은영", "EUNYOUNG"], ["선영", "SUNYOUNG"], ["미영", "MIYOUNG"], ["지영", "JIYOUNG"], ["정아", "JUNGAH"],
    ["소연", "SOYEON"], ["유정", "YUJUNG"], ["보람", "BORAM"], ["윤희", "YOONHEE"], ["민정", "MINJUNG"],
  ],
  M: [
    ["성민", "SUNGMIN"], ["동현", "DONGHYUN"], ["재현", "JAEHYUN"], ["승현", "SEUNGHYUN"], ["태호", "TAEHO"],
    ["준호", "JUNHO"], ["진우", "JINWOO"], ["종민", "JONGMIN"], ["기현", "KIHYUN"], ["상훈", "SANGHOON"],
    ["정훈", "JUNGHOON"], ["영민", "YOUNGMIN"], ["현석", "HYUNSEOK"], ["경민", "KYUNGMIN"], ["대성", "DAESUNG"],
  ],
};

/** 1990년대 이후생 (아이 포함). */
export const YOUNGER: Record<"F" | "M", readonly Given[]> = {
  F: [
    ["민지", "MINJI"], ["서연", "SEOYEON"], ["지은", "JIEUN"], ["유진", "YUJIN"], ["하은", "HAEUN"],
    ["서윤", "SEOYUN"], ["지우", "JIWOO"], ["예린", "YERIN"], ["다은", "DAEUN"], ["수아", "SUA"],
    ["지민", "JIMIN"], ["채원", "CHAEWON"], ["하린", "HARIN"], ["예은", "YEEUN"], ["소율", "SOYUL"],
  ],
  M: [
    ["민준", "MINJUN"], ["서준", "SEOJUN"], ["도윤", "DOYUN"], ["지훈", "JIHOON"], ["현우", "HYUNWOO"],
    ["시우", "SIWOO"], ["하준", "HAJUN"], ["우진", "WOOJIN"], ["주원", "JOOWON"], ["예준", "YEJUN"],
    ["건우", "GUNWOO"], ["지호", "JIHO"], ["은우", "EUNWOO"], ["선우", "SUNWOO"], ["유찬", "YUCHAN"],
  ],
};

export function givenPool(birthYear: number, gender: "F" | "M"): readonly Given[] {
  if (birthYear < 1970) return OLDER[gender];
  if (birthYear < 1990) return MIDDLE[gender];
  return YOUNGER[gender];
}
