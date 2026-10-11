import '../src/shell/base.css';
import '../src/shell/shell.css';
import { mount } from '../src/shell/session';
import { SurveyEditor } from '../src/survey/SurveyEditor';

mount((s) => <SurveyEditor session={s} />);
