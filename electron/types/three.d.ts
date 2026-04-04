/**
 * electrobun 内部で three.js を参照しているが、@types/three がないためエラーになる。
 * このモジュール宣言で TS7016 を抑制する。
 */
declare module 'three';
