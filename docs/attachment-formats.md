# 工作项附件格式

需求、任务、缺陷附件默认单文件上限为10 MiB。前端从 `/auth/me` 读取服务端当前有效的扩展名白名单；服务端最终校验。`ATTACHMENT_EXTENSIONS` 可覆盖默认值，覆盖后前端选择提示与服务端校验保持一致。

附件点击后由本机浏览器中的 File Viewer 3.2.2 按需预览，不经过后端转换。上传格式覆盖项目文档当前全部21种格式，并额外支持常用压缩包、视频、图片、思维导图和绘图文件。实际预览能力依赖浏览器解码能力及文件本身是否有效；预览失败时仍可下载原件。

| 类别 | 扩展名 |
| --- | --- |
| Office、PDF及项目文档格式 | `.doc`、`.docx`、`.xls`、`.xlsx`、`.ppt`、`.pptx`、`.pdf`、`.txt`、`.csv`、`.json`、`.xml`、`.log`、`.md` |
| 常见图片 | `.png`、`.jpg`、`.jpeg`、`.gif`、`.bmp`、`.webp`、`.svg`、`.tif`、`.tiff`、`.avif`、`.ico`、`.heic`、`.heif`、`.jxl` |
| 压缩包与归档 | `.zip`、`.zipx`、`.7z`、`.rar`、`.tar`、`.gz`、`.gzip`、`.tgz`、`.bz2`、`.bzip2`、`.tbz`、`.tbz2`、`.xz`、`.txz`、`.lzma`、`.zst`、`.tzst`、`.cab`、`.ar`、`.cpio`、`.iso`、`.xar`、`.lha`、`.lzh`、`.jar`、`.war`、`.ear`、`.apk`、`.cbz`、`.cbr` |
| 视频和音频 | `.mp4`、`.webm`、`.mpeg`、`.mp3`、`.wav`、`.ogg`、`.oga`、`.opus`、`.m4a`、`.aac`、`.flac`、`.weba` |
| 思维导图与绘图 | `.xmind`、`.drawio`、`.dio`、`.excalidraw`、`.mermaid`、`.mmd`、`.plantuml`、`.puml` |

纯代码文件不在默认白名单中。项目文档上传仍使用 [项目文档预览格式清单](document-formats.md) 的独立21种格式白名单，不受本清单扩展影响。
