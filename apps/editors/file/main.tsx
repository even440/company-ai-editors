import '../src/shell/base.css';
import '../src/shell/shell.css';
import { mount } from '../src/shell/session';
import { FileViewer } from '../src/file/FileViewer';

// 文件只看不改：不用在线心跳
mount((s) => <FileViewer session={s} />, { presenceEvery: 0 });
