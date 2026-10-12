export default function CommunitySelector({ communities, value, onChange, disabled, loading }) {
  return (
    <label className="field">
      <span>Community</span>
      <select
        name="communityId"
        value={value}
        onChange={onChange}
        disabled={disabled || loading}
        required
      >
        <option value="">
          {loading ? 'Loading communities...' : 'Select community'}
        </option>
        {communities.map((community) => (
          <option key={community.id} value={community.id}>
            {community.name}
          </option>
        ))}
      </select>
    </label>
  );
}
