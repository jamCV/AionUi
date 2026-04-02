import { Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

type TeamDelegationBadgeProps = {
  assistantName: string;
  onClose: () => void;
};

const TeamDelegationBadge: React.FC<TeamDelegationBadgeProps> = ({ assistantName, onClose }) => {
  const { t } = useTranslation();
  return (
    <div className='mb-8px'>
      <Tag closable onClose={onClose} color='arcoblue'>
        {t('conversation.team.mention.badge', { assistant: assistantName })}
      </Tag>
    </div>
  );
};

export default TeamDelegationBadge;
