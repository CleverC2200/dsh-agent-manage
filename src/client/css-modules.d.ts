/** 文件作用：为 CSS Modules 导入声明浏览器端可用的类名映射类型。 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
