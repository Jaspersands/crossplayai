import { Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import { MainPage } from './pages/MainPage';

function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<MainPage />} />
      <Route path="/corrections" element={<MainPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
