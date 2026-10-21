import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './components/Auth';
import { EditorsProvider } from './components/editors';
import { StoreProvider } from './lib/store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      {email => (
        <StoreProvider>
          <EditorsProvider>
            <App email={email} />
          </EditorsProvider>
        </StoreProvider>
      )}
    </AuthGate>
  </StrictMode>,
);
